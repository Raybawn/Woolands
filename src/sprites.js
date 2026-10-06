// Procedural pixel art: tiles are painted pixel by pixel into ImageData, sprites from tiny string maps.

import { T, TILE, CHUNK_PX, MOIST, DIRS8, isWet } from './config.js';
import { hash } from './noise.js';
import { BIOMES } from './biomes.js';

// Hex -> packed little-endian RGBA for Uint32Array pixel buffers.
const px = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0;
};
const pxs = (...hexes) => hexes.map(px);
const darken = (hex, f) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f)
  .toString(16).padStart(2, '0')).join('');

// Colours shared by every biome.
const P = {
  bloom:  px('#e8a33d'),
  spring: px('#7cbcec'),
  stone:  pxs('#8b857f', '#6f6a65'),
  fog:    pxs('#ddd5c8', '#e3dccf', '#d5ccbe'),
  snow:   pxs('#f4f8fb', '#dfe8ef'),
  cactus: pxs('#5e9a48', '#3f7834', '#e8e2b8'),
  stump:  pxs('#5a3e28', '#c89a62', '#a87c4a', '#3e2a1c'),
  lily:   pxs('#5f9a3c', '#4a7e2e', '#f0a8c0'),
  ice:    pxs('#eef6fb', '#c4dcec'),
  strata: pxs('#ecd0aa', '#cf8a5c', '#e0aa7c', '#b86c48', '#d8b48a'),
};

// Each biome's palette, packed once. Damp and wet ground are darker shades of the dry ground.
const PAL = BIOMES.map((b) => ({
  dust: [pxs(...b.ground), pxs(...(b.damp ?? b.ground.map((h) => darken(h, 0.83)))),
         pxs(...(b.wet ?? b.ground.map((h) => darken(h, 0.68))))],
  crack: px(b.crack), pebble: px(b.pebble), pebbleRate: b.pebbleRate, deco: b.deco,
  rock: { light: px(b.rocks.light), mid: px(b.rocks.mid), shade: px(b.rocks.shade), line: px(b.rocks.line) },
  rockKind: b.rockKind, frost: !!b.frost,
  moss: pxs(...b.moss), grass: pxs(...b.grass), blade: px(b.blade), shadow: px(b.shadow), petals: pxs(...b.petals),
  water: Object.fromEntries(Object.entries(b.water).map(([k, v]) => [k, px(v)])),
  lily: b.id === 'swamp', ice: b.id === 'snowy',
}));

// Little things lying on bare ground. Letters index into the colours beside them.
const DECO = {
  bush:   { rows: ['.a.a.', 'a.aa.', '.aa.a', '..a..'], colors: { a: px('#7a5a3a') } },
  puddle: { rows: ['.ab.', 'aaba', '.aa.'], colors: { a: px('#4e6a5c'), b: px('#7a9a88') } },
};

// 8×8 rocks that aren't boulders.
const CACTUS = ['...ab...', '...ab.a.', 'a..ab.ab', 'ab.ab.ab', 'abaabab.', '.aaaab..', '...ab...', '...ab...'];
const STUMP = ['........', '..aaaa..', '.abccba.', '.acbbca.', '.abccba.', '.daaaad.', '..dddd..', '........'];

// Unexplored fog, light or dark to match the UI theme.
const FOG = { light: pxs('#ddd5c8', '#e3dccf', '#d5ccbe'), dark: pxs('#2a2730', '#2f2c35', '#26232b') };
export function setFogTheme(dark) { P.fog = dark ? FOG.dark : FOG.light; }

const pick3 = (arr, f) => (f < 0.6 ? arr[0] : f < 0.85 ? arr[1] : arr[2]);

function fogAt(X, Y, seed) {
  const h = hash(X >> 1, Y >> 1, seed ^ 0xf06);
  return pick3(P.fog, (h & 255) / 255);
}

// Water depth needs to know where the land is: every non-water tile within 2, as pixel offsets.
function waterInfo(w, x, y) {
  const land = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && !isWet(w.type(x + dx, y + dy))) land.push(dx * TILE, dy * TILE);
  }
  let shore = 0;
  if (!isWet(w.type(x, y - 1))) shore |= 1;
  if (!isWet(w.type(x, y + 1))) shore |= 2;
  if (!isWet(w.type(x - 1, y))) shore |= 4;
  if (!isWet(w.type(x + 1, y))) shore |= 8;
  return { land, shore };
}

// Paint one tile into buf at (ox, oy). `w` needs type/moist/isRevealed/extra/biome/seed – the World, or a stand-in for icons.
export function paintTile(buf, stride, ox, oy, w, x, y) {
  const seed = w.seed, t = w.type(x, y), m = w.moist(x, y), rev = w.isRevealed(x, y);
  const th = hash(x, y, seed ^ 0x51ed);
  const lvl = m >= MOIST.WET ? 2 : m >= MOIST.DAMP ? 1 : 0;

  // Neighbouring biomes fray into this tile's edges with a dither, so borders aren't hard tile seams.
  const bio = w.biome(x, y);
  const bN = w.biome(x, y - 1), bS = w.biome(x, y + 1), bW = w.biome(x - 1, y), bE = w.biome(x + 1, y);
  const seam = t !== T.ROCK && (bN !== bio || bS !== bio || bW !== bio || bE !== bio);

  // Fog: 3 = solid, 2 = 50% dither (fog edge), 1 = 25% haze (revealed edge), 0 = clear.
  let fog = rev ? 0 : 3;
  for (const [dx, dy] of DIRS8) {
    const r = w.isRevealed(x + dx, y + dy);
    if (rev && !r) { fog = 1; break; }
    if (!rev && r) { fog = 2; break; }
  }

  const water = t === T.WATER && fog !== 3 ? waterInfo(w, x, y) : null;

  for (let py = 0; py < TILE; py++) {
    for (let px_ = 0; px_ < TILE; px_++) {
      const X = x * TILE + px_, Y = y * TILE + py;
      let col;
      if (fog === 3) {
        col = fogAt(X, Y, seed);
      } else {
        const r = hash(X, Y, seed);
        const f = (r & 255) / 255;
        let pal = PAL[bio];
        if (seam) {
          const d = (r >>> 20) & 3;
          const hit = (dist) => (dist === 0 ? d < 2 : dist === 1 && d === 0);
          if (bN !== bio && hit(py)) pal = PAL[bN];
          else if (bS !== bio && hit(7 - py)) pal = PAL[bS];
          else if (bW !== bio && hit(px_)) pal = PAL[bW];
          else if (bE !== bio && hit(7 - px_)) pal = PAL[bE];
        }
        col = terrain(pal, t, lvl, f, r, th, water, px_, py, X, Y, seed, w, x, y);
        if (fog === 2 && ((px_ + py) & 1) === 0) col = fogAt(X, Y, seed);
        else if (fog === 1 && (px_ & 1) === 0 && (py & 1) === 0) col = fogAt(X, Y, seed);
      }
      buf[(oy + py) * stride + ox + px_] = col;
    }
  }
}

function sprite8(rows, x_, y_, colors) {
  const ch = rows[y_][x_];
  return ch === '.' ? null : colors[ch];
}

function terrain(pal, t, lvl, f, r, th, water, x_, y_, X, Y, seed, w, x, y) {
  switch (t) {
    case T.DUST: {
      let col = pick3(pal.dust[lvl], f);
      if (lvl === 0 && (th & 7) === 0) {
        const cx = th & 8 ? 7 - x_ : x_;
        if (cx >= 1 && cx <= 6 && y_ === 2 + ((cx * 3) >> 2)) col = pal.crack;
      }
      if ((th >>> 4) % pal.pebbleRate === 0 && x_ === ((th >>> 8) % 6) + 1 && y_ === ((th >>> 12) % 6) + 1) col = pal.pebble;
      if (pal.deco && (th >>> 18) % 13 === 0) {
        const d = DECO[pal.deco], dx = x_ - 1 - ((th >>> 22) % 3), dy = y_ - 2 - ((th >>> 25) & 1);
        if (dy >= 0 && dy < d.rows.length && dx >= 0 && dx < d.rows[0].length) col = sprite8(d.rows, dx, dy, d.colors) ?? col;
      }
      return col;
    }
    case T.ROCK: {
      const ground = pick3(pal.dust[lvl], f);
      if (pal.rockKind === 'cactus' && (th & 1)) {
        const c = sprite8(CACTUS, x_, y_, { a: P.cactus[0], b: P.cactus[1] });
        if (!c) return ground;
        return c === P.cactus[0] && ((r >>> 9) & 15) === 0 ? P.cactus[2] : c;   // a few spines
      }
      if (pal.rockKind === 'stump' && (th & 1)) {
        return sprite8(STUMP, x_, y_, { a: P.stump[0], b: P.stump[1], c: P.stump[2], d: P.stump[3] }) ?? ground;
      }
      const R = pal.rock;
      const dx = (x_ - 3.5) / 3.7, dy = (y_ - 4.3) / 3.2, d = dx * dx + dy * dy;
      if (d >= 1) return ground;
      if (d > 0.72) return R.line;
      switch (pal.rockKind) {
        case 'mesa':       // stripes follow the world's Y, so neighbouring rocks line up like strata
          if (dy > 0.45) return R.shade;
          return P.strata[(((Y >> 1) + (seed & 7)) % 5 + 5) % 5];
        case 'snowcap':
          if (dy < -0.2 + 0.15 * Math.sin(x_ * 1.7 + th)) return dx < -0.2 ? P.snow[0] : P.snow[x_ & 1];
          break;
        case 'mossy':
          if (dy < -0.3) return pick3(pal.moss, f);
          break;
      }
      if (dy < -0.25 && dx < 0.3) return R.light;
      if (dy > 0.35) return R.shade;
      return R.mid;
    }
    case T.MOSS: {
      const h = hash(X >> 1, Y >> 1, seed ^ 0x3055);
      if (pal.frost && ((h >>> 16) & 31) === 0) return P.snow[0];
      if ((h & 255) < 175) return pick3(pal.moss, ((h >>> 8) & 255) / 255);
      return pick3(pal.dust[Math.max(lvl, 1)], f);
    }
    case T.GRASS: {
      if (th % 13 === 5) {
        const fx = 2 + ((th >>> 8) & 3), fy = 2 + ((th >>> 11) & 3);
        if (x_ === fx && y_ === fy) return P.bloom;
        if (Math.abs(x_ - fx) + Math.abs(y_ - fy) === 1) return pal.petals[(th >>> 14) & 3];
      }
      return grass(pal, f, r, X, Y, seed);
    }
    case T.FLOWERS: {
      // Grass dotted with little blooms, one per 2×2 block where the block hash says so.
      const h = hash(X >> 1, Y >> 1, seed ^ 0x77f1);
      if ((h & 7) < 3) {
        const petal = pal.petals[(h >>> 3) & 3];
        const corner = (X & 1) + 2 * (Y & 1), spot = (h >>> 5) & 3;
        if (corner === spot) return petal;
        if (corner === (spot ^ 3) && (h & 64)) return P.bloom;
      }
      return grass(pal, f, r, X, Y, seed);
    }
    case T.TREE: {
      // Grass with the tree's shadow; the tree itself is drawn as a sprite on top.
      const stage = w.extra(x, y) & 3, rx = [1.2, 2.2, 3.2, 3.9][stage], ry = rx * 0.5;
      const dx = (x_ - 3.5) / rx, dy = (y_ - 6) / ry;
      if (dx * dx + dy * dy <= 1) return pal.shadow;
      return pick3(pal.grass, f);
    }
    case T.WATER:
      return waterPixel(pal, water, th, f, x_, y_, X, Y);
    case T.SPRING: {
      const edge = x_ === 0 || x_ === 7 || y_ === 0 || y_ === 7;
      const corner = (x_ === 0 || x_ === 7) && (y_ === 0 || y_ === 7);
      if (corner) return pick3(pal.dust[lvl], f);
      if (edge) return f < 0.5 ? P.stone[0] : P.stone[1];
      if (x_ >= 3 && x_ <= 4 && y_ >= 3 && y_ <= 4) return P.spring;
      if (x_ >= 2 && x_ <= 5 && y_ >= 2 && y_ <= 5) return f < 0.6 ? pal.water.shallow : pal.water.ripple;
      return f < 0.7 ? pal.water.mid : pal.water.shallow;
    }
  }
  return P.fog[0];
}

function grass(pal, f, r, X, Y, seed) {
  if (pal.frost && (hash(X >> 1, Y >> 1, seed ^ 0x5a0) & 31) === 0) return P.snow[(X ^ Y) & 1];
  if (((r >>> 8) & 31) === 0) return pal.blade;
  return pick3(pal.grass, f);
}

// Water gets lighter toward the shore and darker in open water, measured from the real distance to land,
// so the bands curve smoothly across tile borders. The north bank shades the water just below it.
function waterPixel(pal, wi, th, f, x_, y_, X, Y) {
  const W = pal.water, s = wi.shore;
  // Round off outer corners with a pixel of wet bank.
  if ((x_ === 0 || x_ === 7) && (y_ === 0 || y_ === 7)) {
    const v = y_ === 0 ? s & 1 : s & 2, h = x_ === 0 ? s & 4 : s & 8;
    if (v && h) return pick3(pal.dust[2], f);
  }
  let d2 = 1e9;
  const cx = x_ + 0.5, cy = y_ + 0.5, L = wi.land;
  for (let k = 0; k < L.length; k += 2) {
    const dx = Math.max(L[k] - cx, 0, cx - L[k] - TILE), dy = Math.max(L[k + 1] - cy, 0, cy - L[k + 1] - TILE);
    const dd = dx * dx + dy * dy;
    if (dd < d2) d2 = dd;
  }
  const d = Math.sqrt(d2), checker = ((X + Y) & 1) === 0;
  if (d < 1) {
    if (y_ === 0 && (s & 1)) return W.bank;
    return f < 0.55 ? W.foam : W.shallow;
  }
  if (d < 2.5) return W.shallow;
  if (d < 4) return checker ? W.shallow : W.mid;

  // Lily pads on swamp water, ice floes on snowy water.
  if ((pal.lily && th % 5 === 0) || (pal.ice && th % 4 === 0)) {
    const lx = 2 + ((th >>> 8) % 4), ly = 2 + ((th >>> 11) % 4), dx = x_ - lx, dy = y_ - ly;
    if (pal.lily && Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && !(dx === 1 && dy === -1)) {
      if (!dx && !dy && (th & 0x10000)) return P.lily[2];
      return dy === 1 ? P.lily[1] : P.lily[0];
    }
    if (pal.ice && dx >= -1 && dx <= 1 && dy >= 0 && dy <= 1) return dy === 1 ? P.ice[1] : P.ice[0];
  }

  const ripple = ((y_ + (th & 3)) & 3) === 0 && ((x_ + ((th >>> 2) & 7)) & 7) < 2;
  if (d < 9) return ripple ? W.ripple : W.mid;
  if (d < 11) return checker ? W.mid : W.deep;
  return ripple ? W.mid : W.deep;
}

// One chunk-sized canvas of plain fog, drawn wherever no chunk exists yet.
export function makeFogCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = CHUNK_PX;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(CHUNK_PX, CHUNK_PX);
  const buf = new Uint32Array(img.data.buffer);
  for (let y = 0; y < CHUNK_PX; y++) for (let x = 0; x < CHUNK_PX; x++) buf[y * CHUNK_PX + x] = fogAt(x, y, 7);
  ctx.putImageData(img, 0, 0);
  return c;
}

// --- sprites -------------------------------------------------------------------

// w = wool, s = wool shade, H = head, e = eye, l = legs. Facing right.
const SHEEP_FRAMES = {
  idle:  ['..ww.w..', '.wwwwwHH', 'wwwwwwHe', 'swwwwwH.', '.ssss...', '.l..l...'],
  walkA: ['..ww.w..', '.wwwwwHH', 'wwwwwwHe', 'swwwwwH.', '.ssss...', '.l..l...'],
  walkB: ['..ww.w..', '.wwwwwHH', 'wwwwwwHe', 'swwwwwH.', '.ssss...', '..l..l..'],
  graze: ['........', '..ww.w..', '.wwwwww.', 'wwwwwwHH', 'swwwwsHe', '.l..l...'],
  nap:   ['........', '........', '..ww.w..', '.wwwwwHH', 'wwwwwwHH', 'sssssss.'],
};

// Lambs: 6×5, same colour keys.
const LAMB_FRAMES = {
  idle:  ['..w.w.', '.wwwHH', 'wwwwHe', '.sss..', '.l.l..'],
  walkA: ['..w.w.', '.wwwHH', 'wwwwHe', '.sss..', '.l.l..'],
  walkB: ['..w.w.', '.wwwHH', 'wwwwHe', '.sss..', 'l...l.'],
  graze: ['......', '..w.w.', '.wwww.', 'wwwwHH', '.l.lHe'],
  nap:   ['......', '......', '..w.w.', '.wwwHH', 'sssss.'],
};

const SHEEP_COLORS = [
  { w: '#f4f1ea', s: '#d4cdbf', H: '#4a3f3a', e: '#1f1915', l: '#3a302c' }, // white
  { w: '#efe2c6', s: '#d3c29f', H: '#5a4a3f', e: '#1f1915', l: '#3a302c' }, // cream
  { w: '#c9c6c2', s: '#a7a39e', H: '#3d3633', e: '#151110', l: '#2f2926' }, // grey
  { w: '#a78563', s: '#8a6b4d', H: '#3d3029', e: '#120d0b', l: '#2f2520' }, // brown
  { w: '#4d4645', s: '#3a3434', H: '#211c1b', e: '#8d8580', l: '#1b1716' }, // black
];

function spriteCanvas(rows, colors, flip = false) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = colors[ch];
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    });
  });
  return c;
}

// sprites[look][frame] = [facingRight, facingLeft]
function buildFrames(frames) {
  return SHEEP_COLORS.map((colors) => {
    const out = {};
    for (const [name, rows] of Object.entries(frames)) {
      out[name] = [spriteCanvas(rows, colors), spriteCanvas(rows, colors, true)];
    }
    return out;
  });
}
export const buildSheepSprites = () => buildFrames(SHEEP_FRAMES);
export const buildLambSprites = () => buildFrames(LAMB_FRAMES);

// --- trees -------------------------------------------------------------------------

// Species: 0 oak, 1 pine, 2 birch, 3 blossom, 4 acacia, 5 snowy pine.
export const TREE_COLORS = [
  { leaf: ['#4f8a33', '#3f7429', '#6aa845'], line: '#2f5520', trunk: '#6b4a32' },
  { leaf: ['#3a6b3a', '#2d5630', '#4f8a4a'], line: '#1f3d22', trunk: '#5e4030' },
  { leaf: ['#7cae4a', '#679a3c', '#9cc865'], line: '#4a7230', trunk: '#e8e2d6' },
  { leaf: ['#e8a0b4', '#d4849c', '#f6c6d2'], line: '#a8607a', trunk: '#6b4a32' },
  { leaf: ['#7a9a3a', '#62822e', '#98b452'], line: '#4a6224', trunk: '#8a6040' },
  { leaf: ['#3a6b4a', '#2d5638', '#4f8a5a'], line: '#1f3d2a', trunk: '#5e4030', snow: '#f4f8fb' },
];
const PINE = (sp) => sp === 1 || sp === 5;

// Picked per tile from the world hash, weighted by the biome's own mix of trees.
export function treeSpecies(x, y, seed, biome = 0) {
  const opts = BIOMES[biome].trees;
  let h = hash(x, y, seed ^ 0x7ee5) % opts.reduce((a, o) => a + o[1], 0);
  for (const [sp, weight] of opts) {
    if (h < weight) return sp;
    h -= weight;
  }
  return 0;
}

// Returns { canvas, ax, ay }: the anchor (ax, ay) is the trunk's base.
function makeTree(species, stage) {
  const col = TREE_COLORS[species];
  const size = 20, c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const ax = 10, ay = 18;
  const dot = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); };

  if (stage === 0) {
    // Sapling: a stem with two leaves.
    dot(ax, ay, col.trunk); dot(ax, ay - 1, col.trunk); dot(ax, ay - 2, col.leaf[0]);
    dot(ax - 1, ay - 2, col.leaf[2]); dot(ax + 1, ay - 3, col.leaf[0]); dot(ax - 1, ay - 3, col.leaf[1]);
    return { canvas: c, ax, ay };
  }
  const acacia = species === 4;
  const trunkH = (acacia ? [0, 3, 4, 6] : [0, 2, 3, 4])[stage], R = [0, 2.6, 3.8, 5][stage];
  ctx.fillStyle = col.trunk;
  ctx.fillRect(ax - (stage === 3 ? 1 : 0), ay - trunkH + 1, stage === 3 ? 2 : 1, trunkH);
  if (acacia && stage >= 2) {
    // A crooked branch forking off to the side.
    dot(ax - 1, ay - trunkH + 2, col.trunk);
    dot(ax - 2, ay - trunkH + 1, col.trunk);
  }

  const cy = acacia ? ay - trunkH - R * 0.35 : ay - trunkH - R + 1;
  const inside = PINE(species)
    // Pine: stacked tiers that get wider toward the bottom.
    ? (dx, dy) => {
      const t = (dy + R * 1.3) / (R * 2.5);
      if (t < 0 || t > 1) return false;
      const tier = (t * 3) % 1;
      return Math.abs(dx) <= R * (0.35 + 0.65 * t) * (0.6 + 0.4 * tier);
    }
    : acacia
      // Acacia: a wide, flat umbrella.
      ? (dx, dy) => (dx / (R * 1.45)) ** 2 + (dy / (R * 0.5)) ** 2 <= 1
        || (dx / (R * 0.8)) ** 2 + ((dy + R * 0.35) / (R * 0.4)) ** 2 <= 1
      // Leafy: three overlapping blobs.
      : (dx, dy) => Math.hypot(dx, dy) <= R
        || Math.hypot(dx + R * 0.55, dy - R * 0.35) <= R * 0.7
        || Math.hypot(dx - R * 0.55, dy - R * 0.35) <= R * 0.7;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - ax + 0.5 * (stage === 3 ? 0 : 1) - 0.5, dy = y - cy;
      if (!inside(dx, dy)) continue;
      const edge = !inside(dx - 1, dy) || !inside(dx + 1, dy) || !inside(dx, dy - 1) || !inside(dx, dy + 1);
      let color = col.leaf[0];
      if (col.snow && !inside(dx, dy - 1)) color = col.snow;        // snow settles on every ledge
      else if (edge) color = col.line;
      else if (dx + dy < -R * 0.5) color = col.leaf[2];
      else if (dx + dy > R * 0.45) color = col.leaf[1];
      else if (hash(x, y, species * 31 + stage) % 9 === 0) color = col.leaf[1];
      dot(x, y, color);
    }
  }
  // Birch bark marks, blossom petals.
  if (species === 2) for (let k = 1; k < trunkH; k += 2) dot(ax, ay - k, '#3b2f2a');
  if (species === 3) {
    for (let k = 0; k < stage * 3; k++) {
      const h = hash(k, stage, 99);
      const span = Math.round(R * 2) + 1;
      const x = Math.round(ax - R + (h % span)), y = Math.round(cy - R + ((h >>> 8) % span));
      if (inside(x - ax, y - cy)) dot(x, y, '#fff3f6');
    }
  }
  return { canvas: c, ax, ay };
}

// trees[species][stage]
export function buildTreeSprites() {
  return TREE_COLORS.map((_, sp) => [0, 1, 2, 3].map((st) => makeTree(sp, st)));
}

// Leaves (or petals) a full tree of this species lets fall; pines keep theirs.
export function leafColors(species) {
  if (PINE(species)) return null;
  return species === 3 ? ['#f6c6d2', '#e88aa0', '#fff3f6'] : [...TREE_COLORS[species].leaf, '#d9a441'];
}

// --- clouds --------------------------------------------------------------------------

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];

// A rain cloud roughly r tiles in radius: a row of round puffs on a flat base, two more peeking over the top,
// lit from the top left and outlined, in slate blues.
const RAIN_CLOUD = { line: '#46506c', under: '#66728f', mid: '#8692ae', light: '#a8b4cc', top: '#ccd5e5', seam: '#727e9b' };

export function makeCloud(r) {
  const w = Math.round(r * 2 * TILE * 0.95) + 6, h = Math.max(13, Math.round(w * 0.46));
  const base = h - 2;
  const front = [], back = [];
  const n = Math.max(3, Math.round(w / 9));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), pr = h * (0.27 + 0.11 * Math.sin(t * Math.PI));
    front.push([pr + 1 + t * (w - 2 * pr - 2), base - pr * 0.75, pr]);
  }
  for (const [t, k] of [[0.38, 0.38], [0.64, 0.32]]) back.push([w * t, h * k + 1, h * k]);
  const puffs = [...front, ...back];
  const y0 = base - h * 0.3, x0 = front[0][0], x1 = front[n - 1][0];
  const inP = ([cx, cy, pr], x, y) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= pr;
  const inside = (x, y) => y >= 0 && y <= base && x >= 0 && x < w
    && ((y >= y0 && x >= x0 && x <= x1) || puffs.some((p) => inP(p, x, y)));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  for (let y = 0; y <= base; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      let col;
      if (!inside(x, y - 1) || !inside(x, y + 1) || !inside(x - 1, y) || !inside(x + 1, y)) col = RAIN_CLOUD.line;
      else if (y >= base - 2 || (y === base - 3 && (x & 1))) col = RAIN_CLOUD.under;
      else {
        // Shade by the front-most puff this pixel belongs to; draw its rim where it overlaps a puff behind.
        const p = front.find((q) => inP(q, x, y)) ?? back.find((q) => inP(q, x, y));
        if (!p) col = RAIN_CLOUD.mid;
        else {
          const ux = (x + 0.5 - p[0]) / p[2], uy = (y + 0.5 - p[1]) / p[2], nd = Math.hypot(ux, uy);
          const lit = -(ux * 0.6 + uy);
          if (front.includes(p) && nd > 0.82 && uy < 0 && Math.abs(ux) < 0.5 && back.some((q) => inP(q, x, y))) {
            col = RAIN_CLOUD.seam;
          }
          else col = lit > 0.75 ? RAIN_CLOUD.top : lit > 0.2 ? RAIN_CLOUD.light : RAIN_CLOUD.mid;
        }
      }
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// A soft, high cloud for the sky: overlapping puffs whose edges fade out through an ordered dither,
// plus a matching shadow for the ground. Returns { body, shadow }.
export function makeSoftCloud(seed) {
  let s = seed | 0;
  const rnd = () => {   // mulberry32
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const w = 52 + Math.floor(rnd() * 52), h = Math.round(w * 0.5);
  const blobs = [[w * (0.45 + 0.1 * rnd()), h * 0.5, w * 0.2]];   // a big middle, then smaller puffs around it
  const n = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const bx = w * (0.22 + 0.56 * rnd());
    const br = w * (0.1 + 0.07 * rnd()) * (1.3 - Math.abs(bx / w - 0.5) * 1.2);
    blobs.push([bx, h * (0.46 + 0.16 * rnd()), br]);
  }
  const density = (x, y) => {
    let d = 0;
    for (const [bx, by, br] of blobs) d = Math.max(d, 1 - Math.hypot((x - bx) / br, (y - by) / (br * 0.72)));
    return d;
  };

  const make = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    return [c, ctx, ctx.createImageData(w, h)];
  };
  const [body, bctx, bimg] = make(), [shadow, sctx, simg] = make();
  const put = (img, x, y, [r, g, b], a) => {
    const i = (y * w + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = density(x + 0.5, y + 0.5), b = bayer(x, y);
      if (d <= 0) continue;
      if (d > 0.42 + b * 0.12) {
        const under = density(x + 0.5, y + 4.5) < 0.42;   // the bottom rim of the bright core
        put(bimg, x, y, under ? [220, 228, 239] : [255, 255, 255], 255);
      } else if (d > 0.18 + b * 0.12) put(bimg, x, y, [240, 244, 250], 190);
      else if (d > b * 0.16) put(bimg, x, y, [232, 237, 245], 95);
      if (d > 0.08 + b * 0.2) put(simg, x, y, [24, 32, 62], 255);
    }
  }
  bctx.putImageData(bimg, 0, 0);
  sctx.putImageData(simg, 0, 0);
  return { body, shadow };
}

const ICONS = {
  life: {
    rows: ['........', '.gg...gg', 'gGgg.ggG', '.gggdgg.', '....d...', '....d...', '..bbbbb.', '.bbbbbbb'],
    colors: { g: '#5c9a3b', G: '#86c25a', d: '#4f8a33', b: '#957f63' },
  },
  rain: {
    rows: ['...b....', '...b....', '..bbb...', '..bLb...', '.bbLbb..', '.bbbbb..', '..bbb...', '........'],
    colors: { b: '#3c7cc0', L: '#a5d3f3' },
  },
  sheep: { rows: ['........', ...SHEEP_FRAMES.idle, '........'], colors: SHEEP_COLORS[0] },
  hourglass: {
    rows: ['bbbbbbb.', '.wSSSw..', '..wSw...', '...w....', '..wsw...', '.wsssw..', 'bbbbbbb.', '........'],
    colors: { b: '#8a6a4a', w: '#9fc3dc', S: '#e8c27a', s: '#d9a95a' },
  },
  book: {
    rows: ['.bbbbbb.', '.bRRRRb.', '.bRyyRb.', '.bRRRRb.', '.bRRRRb.', '.bRRRRb.', '.bppppb.', '.bbbbbb.'],
    colors: { b: '#3b2f2a', R: '#5c9a3b', y: '#f2e66b', p: '#f1e8d4' },
  },
  tree: {
    rows: ['..ggg...', '.gGggg..', 'gGgggdg.', 'ggggggd.', '.gggddd.', '..ddd...', '...b....', '..bbb...'],
    colors: { g: '#4f8a33', G: '#6aa845', d: '#3f7429', b: '#6b4a32' },
  },
  sparkle: {
    rows: ['...y....', '...y....', '..yYy...', 'yyYWYyy.', '..yYy...', '...y....', '...y....', '........'],
    colors: { y: '#e8a33d', Y: '#f2e66b', W: '#fff8e6' },
  },
  compass: {
    rows: ['..bbb...', '.bwrwb..', 'bwwrwwb.', 'bwwWwwb.', 'bwwswwb.', '.bwswb..', '..bbb...', '........'],
    colors: { b: '#8a6a4a', w: '#f1e8d4', r: '#c0503a', s: '#6b7896', W: '#3b2f2a' },
  },
  sun: {
    rows: ['y..y..y.', '.yYYYy..', '.YYWYY..', 'yYWYYYy.', '.YYYYY..', '.yYYYy..', 'y..y..y.', '........'],
    colors: { y: '#e8a33d', Y: '#f2e66b', W: '#fff8e6' },
  },
  moon: {
    rows: ['..mmm...', '.mmM....', 'mmM.....', 'mmM.....', 'mmM.....', '.mmM..m.', '..mmmm..', '........'],
    colors: { m: '#f2e66b', M: '#e8a33d' },
  },
};

// Small data-URL icons for the HUD, in the same pixel style as the world.
export function iconURL(name) {
  if (name === 'sapling') name = 'tree';
  if (ICONS[name]) return spriteCanvas(ICONS[name].rows, ICONS[name].colors).toDataURL();
  const type = name === 'spring' ? T.SPRING : T.MOSS;
  const fake = {
    seed: 3,
    type: (x, y) => (x === 0 && y === 0 ? type : T.DUST),
    moist: () => 60,
    extra: () => 0,
    biome: () => 0,
    isRevealed: () => true,
  };
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(TILE, TILE);
  paintTile(new Uint32Array(img.data.buffer), TILE, 0, 0, fake, 0, 0);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}
