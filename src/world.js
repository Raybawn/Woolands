// The infinite tile world, stored as lazily created 16×16 chunks.
// Untouched terrain is regenerated from the seed; only chunks that exist get saved.

import {
  CHUNK, CHUNK_SHIFT, CHUNK_AREA, T, MOIST, DIRS4, REVEAL_RADIUS, isLiving, isWet,
} from './config.js';
import { fbm } from './noise.js';
import { BIOMES, biomeAt } from './biomes.js';

const MASK = CHUNK - 1;
export const LAYERS = 4;                       // type, moisture, revealed, extra
export const CHUNK_BYTES = CHUNK_AREA * LAYERS;
export const tileIndex = (x, y) => ((y & MASK) << CHUNK_SHIFT) | (x & MASK);
const moistLevel = (m) => (m >= MOIST.WET ? 2 : m >= MOIST.DAMP ? 1 : 0);

export class Chunk {
  constructor(cx, cy) {
    this.cx = cx;
    this.cy = cy;
    this.type = new Uint8Array(CHUNK_AREA);
    this.moist = new Uint8Array(CHUNK_AREA);
    this.revealed = new Uint8Array(CHUNK_AREA);
    this.extra = new Uint8Array(CHUNK_AREA);   // per-type data, e.g. tree growth stage
    this.biome = new Uint8Array(CHUNK_AREA);   // from the seed, never saved
    this.elev = new Float32Array(CHUNK_AREA);
    this.grass = 0;   // grass + flowers: where sheep can arrive
    this.trees = 0;
    this.water = 0;
    // Render cache, owned by the renderer.
    this.dirty = true;
    this.canvas = null;
    this.lastSeen = 0;
  }
}

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.chunks = new Map();
    this.counts = { moss: 0, grass: 0, flowers: 0, trees: 0, water: 0 };
    this.bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }; // revealed area, in tiles
    this.revealRadius = REVEAL_RADIUS;
    this.seenBiomes = new Set();
    this.foundBiomes = [];   // newly revealed biomes, drained by the game for the journal
  }

  static key(cx, cy) { return cx + ',' + cy; }

  // --- generation -----------------------------------------------------------

  baseType(x, y, biome = this.biome(x, y)) {
    if (x * x + y * y > 40 && fbm(x / 5, y / 5, this.seed ^ 0x9e37, 2) > BIOMES[biome].rock) return T.ROCK;
    return T.DUST;
  }

  elevation(x, y) { return fbm(x / 26, y / 26, this.seed, 3); }

  generate(cx, cy) {
    const c = new Chunk(cx, cy);
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = cx * CHUNK + lx, y = cy * CHUNK + ly, i = (ly << CHUNK_SHIFT) | lx;
        const b = biomeAt(x, y, this.seed);
        c.biome[i] = b;
        c.type[i] = this.baseType(x, y, b);
        c.elev[i] = this.elevation(x, y);
        if (BIOMES[b].moist) c.moist[i] = BIOMES[b].moist + ((x * 7 + y * 13) & 7);
      }
    }
    return c;
  }

  // --- access ---------------------------------------------------------------

  peekChunk(cx, cy) { return this.chunks.get(World.key(cx, cy)); }
  chunkAt(x, y) { return this.chunks.get(World.key(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT)); }

  getChunk(cx, cy) {
    const k = World.key(cx, cy);
    let c = this.chunks.get(k);
    if (!c) {
      c = this.generate(cx, cy);
      this.chunks.set(k, c);
    }
    return c;
  }

  type(x, y) { const c = this.chunkAt(x, y); return c ? c.type[tileIndex(x, y)] : this.baseType(x, y); }
  moist(x, y) { const c = this.chunkAt(x, y); return c ? c.moist[tileIndex(x, y)] : 0; }
  isRevealed(x, y) { const c = this.chunkAt(x, y); return c ? c.revealed[tileIndex(x, y)] === 1 : false; }
  elev(x, y) { const c = this.chunkAt(x, y); return c ? c.elev[tileIndex(x, y)] : this.elevation(x, y); }
  extra(x, y) { const c = this.chunkAt(x, y); return c ? c.extra[tileIndex(x, y)] : 0; }
  biome(x, y) { const c = this.chunkAt(x, y); return c ? c.biome[tileIndex(x, y)] : biomeAt(x, y, this.seed); }

  hasNeighbor(x, y, t) {
    for (const [dx, dy] of DIRS4) if (this.type(x + dx, y + dy) === t) return true;
    return false;
  }

  countAround(x, y, r, t) {
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (this.type(x + dx, y + dy) === t) n++;
    return n;
  }

  livingNeighbors(x, y) {
    let n = 0;
    for (const [dx, dy] of DIRS4) if (isLiving(this.type(x + dx, y + dy))) n++;
    return n;
  }

  // --- mutation -------------------------------------------------------------

  setType(x, y, t, extra = 0) {
    const c = this.getChunk(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT), i = tileIndex(x, y), old = c.type[i];
    if (old === t) return;
    this._count(c, old, -1);
    this._count(c, t, 1);
    c.type[i] = t;
    c.extra[i] = extra;
    this.markDirty(x, y);
    if (isLiving(t) || isWet(t)) this.reveal(x, y, this.revealRadius);
  }

  setExtra(x, y, v) {
    const c = this.getChunk(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT);
    c.extra[tileIndex(x, y)] = v;
    this.markDirty(x, y);
  }

  _count(c, t, d) {
    if (t === T.MOSS) this.counts.moss += d;
    else if (t === T.GRASS) { this.counts.grass += d; c.grass += d; }
    else if (t === T.FLOWERS) { this.counts.flowers += d; c.grass += d; }
    else if (t === T.TREE) { this.counts.trees += d; c.trees += d; }
    else if (isWet(t)) { this.counts.water += d; c.water += d; }
  }

  raiseMoist(x, y, v) {
    v = Math.min(255, Math.round(v));
    const c = this.getChunk(x >> CHUNK_SHIFT, y >> CHUNK_SHIFT), i = tileIndex(x, y), old = c.moist[i];
    if (v <= old) return;
    c.moist[i] = v;
    if (moistLevel(old) !== moistLevel(v)) this.markDirty(x, y);
  }

  addMoist(x, y, amount) { this.raiseMoist(x, y, this.moist(x, y) + amount); }

  // Raise moisture in a circle, fading with distance.
  wet(x, y, r, peak, falloff) {
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const v = peak - d * falloff;
        if (v > 0) this.raiseMoist(x + dx, y + dy, v);
      }
    }
  }

  reveal(x, y, r) {
    const R = Math.ceil(r), b = this.bounds;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > r * r + r) continue;
        const tx = x + dx, ty = y + dy;
        const c = this.getChunk(tx >> CHUNK_SHIFT, ty >> CHUNK_SHIFT), i = tileIndex(tx, ty);
        if (c.revealed[i]) continue;
        c.revealed[i] = 1;
        if (!this.seenBiomes.has(c.biome[i])) {
          this.seenBiomes.add(c.biome[i]);
          this.foundBiomes.push(c.biome[i]);
        }
        this.markDirty(tx, ty);
        if (tx < b.minX) b.minX = tx;
        if (tx > b.maxX) b.maxX = tx;
        if (ty < b.minY) b.minY = ty;
        if (ty > b.maxY) b.maxY = ty;
      }
    }
  }

  // Flag the tile's chunk for repaint, plus neighbours when the tile sits on an edge
  // (their fog dithering and shorelines depend on it).
  markDirty(x, y) {
    const cx = x >> CHUNK_SHIFT, cy = y >> CHUNK_SHIFT, lx = x & MASK, ly = y & MASK;
    const x0 = lx === 0 ? -1 : 0, x1 = lx === MASK ? 1 : 0;
    const y0 = ly === 0 ? -1 : 0, y1 = ly === MASK ? 1 : 0;
    for (let dy = y0; dy <= y1; dy++) {
      for (let dx = x0; dx <= x1; dx++) {
        const c = this.peekChunk(cx + dx, cy + dy);
        if (c) c.dirty = true;
      }
    }
  }

  // --- persistence ----------------------------------------------------------

  writeChunk(c, out, off) {
    out.set(c.type, off);
    out.set(c.moist, off + CHUNK_AREA);
    out.set(c.revealed, off + 2 * CHUNK_AREA);
    out.set(c.extra, off + 3 * CHUNK_AREA);
  }

  // `layers` lets older saves (3 layers, no extra) load too.
  readChunk(cx, cy, src, off, layers = LAYERS) {
    const c = this.getChunk(cx, cy);
    c.type.set(src.subarray(off, off + CHUNK_AREA));
    c.moist.set(src.subarray(off + CHUNK_AREA, off + 2 * CHUNK_AREA));
    c.revealed.set(src.subarray(off + 2 * CHUNK_AREA, off + 3 * CHUNK_AREA));
    if (layers > 3) c.extra.set(src.subarray(off + 3 * CHUNK_AREA, off + 4 * CHUNK_AREA));
    c.dirty = true;
  }

  // Rebuild counters and bounds after loading.
  recount() {
    this.counts = { moss: 0, grass: 0, flowers: 0, trees: 0, water: 0 };
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const c of this.chunks.values()) {
      c.grass = 0;
      c.trees = 0;
      c.water = 0;
      for (let i = 0; i < CHUNK_AREA; i++) {
        this._count(c, c.type[i], 1);
        if (c.revealed[i]) {
          this.seenBiomes.add(c.biome[i]);
          const x = c.cx * CHUNK + (i & MASK), y = c.cy * CHUNK + (i >> CHUNK_SHIFT);
          if (x < b.minX) b.minX = x;
          if (x > b.maxX) b.maxX = x;
          if (y < b.minY) b.minY = y;
          if (y > b.maxY) b.maxY = y;
        }
      }
    }
    this.bounds = b.minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : b;
    this.foundBiomes = [];
  }
}
