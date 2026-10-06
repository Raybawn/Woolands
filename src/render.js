// Draws the world onto a small low-res canvas that CSS scales up crisply.
// Terrain is cached per chunk and repainted only when it changes; water shimmer, sheep, clouds,
// birds and effects are drawn on top every frame.

import { TILE, CHUNK, CHUNK_PX, CHUNK_AREA, CHUNK_SHIFT, T, isWet } from './config.js';
import { hash } from './noise.js';
import { B } from './biomes.js';
import {
  paintTile, makeFogCanvas, buildSheepSprites, buildLambSprites, buildTreeSprites, treeSpecies, leafColors,
  makeCloud, makeSoftCloud, setFogTheme,
} from './sprites.js';

import { clamp } from './util.js';

const REPAINTS_PER_FRAME = 6;
const MAX_FIREFLIES = 50;
const MAX_BUTTERFLIES = 10;
const MAX_PARTICLES = 500;
const CLOUD_HEIGHT = 20;   // pixels a rain cloud floats above its rain

// Soft clouds drifting high over the valley.
const SKY_CLOUD_VARIANTS = 6;
const SKY_CLOUD_MARGIN = 120;       // pixels around the view where clouds wait to drift in
const SKY_CLOUD_AREA = 42000;       // one cloud per this many square pixels, roughly
const SKY_CLOUD_LIFT = [-14, -46];  // the cloud sits up and to the left of its shadow (sun from the top left)
const SKY_CLOUD_ALPHA = 0.45;
const SKY_SHADOW_ALPHA = 0.15;

// Light colour multiplied over the scene through the day (phase 0 = midnight).
const SKY = [
  [0.00, [92, 104, 168]],
  [0.18, [92, 104, 168]],
  [0.23, [205, 160, 175]],
  [0.29, [255, 236, 214]],
  [0.36, [255, 255, 255]],
  [0.66, [255, 255, 255]],
  [0.73, [250, 196, 140]],
  [0.79, [176, 124, 150]],
  [0.84, [92, 104, 168]],
  [1.00, [92, 104, 168]],
];

function skyTint(p) {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [p0, c0] = SKY[i], [p1, c1] = SKY[i + 1];
    if (p <= p1) {
      const f = (p - p0) / (p1 - p0 || 1);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
    }
  }
  return SKY[0][1];
}

const pickOne = (arr) => arr[(Math.random() * arr.length) | 0];

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.fog = makeFogCanvas();
    this.sheepSprites = buildSheepSprites();
    this.lambSprites = buildLambSprites();
    this.treeSprites = buildTreeSprites();
    this.softClouds = Array.from({ length: SKY_CLOUD_VARIANTS }, (_, i) => makeSoftCloud(i * 7919 + 13));
    this.cloudCache = {};
    this.img = new ImageData(CHUNK_PX, CHUNK_PX);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.particles = [];
    this.skyClouds = [];     // { x, y, v, speed, age } – x, y is the shadow's centre in world pixels
    this.birds = [];
    this.birdTimer = 20 + Math.random() * 30;
    this.wind = { x: 5, y: 1 };
    this.hover = null;       // { x, y, ok } in tiles
    this.time = 0;
    this.scale = 0;
    this.phase = null;       // displayed sky phase, eased toward the game's
    this.tint = [255, 255, 255];
    this.night = 0;
    this.resize();
    this.setGame(game);
  }

  setGame(game) {
    this.game = game;
    this.particles = [];
    this.skyClouds = [];
    this.cloudsSeeded = false;
    this.birds = [];
    this.phase = null;
    const v = game.view;
    this.cam = v ? { x: v.x, y: v.y } : { x: TILE / 2, y: TILE / 2 };
    this.setScale(v ? Math.round(v.s * this.dpr) : this.defaultScale());
    game.on((ev) => this.onEvent(ev));
  }

  // Camera state to store in the save; scale relative to CSS pixels so it carries across devices.
  viewState() { return { x: Math.round(this.cam.x), y: Math.round(this.cam.y), s: this.scale / this.dpr }; }

  // Repaint the fog to match the UI theme. Visible chunks repaint on the next frame.
  setTheme(dark) {
    setFogTheme(dark);
    this.dark = dark;
    this.fog = makeFogCanvas();
    for (const c of this.game.world.chunks.values()) c.canvas = null;
  }

  // --- sizing & camera ----------------------------------------------------------

  limits() {
    return { min: Math.max(1, Math.round(this.dpr)), max: Math.max(2, Math.round(this.dpr * 8)) };
  }

  defaultScale() {
    return Math.round(Math.min(this.devW, this.devH) / (20 * TILE));
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.devW = Math.round(window.innerWidth * this.dpr);
    this.devH = Math.round(window.innerHeight * this.dpr);
    this.setScale(this.scale || this.defaultScale());
  }

  setScale(s) {
    const { min, max } = this.limits();
    this.scale = clamp(Math.round(s), min, max);
    const c = this.canvas;
    c.width = Math.ceil(this.devW / this.scale);
    c.height = Math.ceil(this.devH / this.scale);
    c.style.width = `${(c.width * this.scale) / this.dpr}px`;
    c.style.height = `${(c.height * this.scale) / this.dpr}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  left() { return Math.round(this.cam.x - this.canvas.width / 2); }
  top() { return Math.round(this.cam.y - this.canvas.height / 2); }

  // Zoom, keeping the world point under the given screen position fixed.
  zoomAt(s, clientX, clientY) {
    const { min, max } = this.limits();
    s = clamp(Math.round(s), min, max);
    if (s === this.scale) return;
    const sx = clientX * this.dpr, sy = clientY * this.dpr;
    const wx = this.left() + sx / this.scale, wy = this.top() + sy / this.scale;
    this.setScale(s);
    this.cam.x = wx - sx / s + this.canvas.width / 2;
    this.cam.y = wy - sy / s + this.canvas.height / 2;
    this.clampCam();
  }

  panBy(dxClient, dyClient) {
    this.cam.x -= (dxClient * this.dpr) / this.scale;
    this.cam.y -= (dyClient * this.dpr) / this.scale;
    this.clampCam();
  }

  clampCam() {
    const b = this.game.world.bounds;
    this.cam.x = clamp(this.cam.x, b.minX * TILE, (b.maxX + 1) * TILE);
    this.cam.y = clamp(this.cam.y, b.minY * TILE, (b.maxY + 1) * TILE);
  }

  screenToWorld(clientX, clientY) {
    return {
      x: this.left() + (clientX * this.dpr) / this.scale,
      y: this.top() + (clientY * this.dpr) / this.scale,
    };
  }

  screenToTile(clientX, clientY) {
    const p = this.screenToWorld(clientX, clientY);
    return { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) };
  }

  // --- effects --------------------------------------------------------------------

  onEvent(ev) {
    const cx = ev.x * TILE + 4, cy = ev.y * TILE + 4;
    if (ev.type === 'place' || ev.type === 'wander') {
      const col = ev.tool === 'spring' ? '#cfe6f2' : '#b7d27a';
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2, v = 8 + Math.random() * 14;
        this.particles.push({ kind: 'dot', x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, life: 0.6, col });
      }
    }
  }

  // --- drawing ----------------------------------------------------------------------

  paintChunk(c) {
    if (!c.canvas) {
      c.canvas = document.createElement('canvas');
      c.canvas.width = c.canvas.height = CHUNK_PX;
    }
    const w = this.game.world, bx = c.cx * CHUNK, by = c.cy * CHUNK;
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) paintTile(this.buf, CHUNK_PX, lx * TILE, ly * TILE, w, bx + lx, by + ly);
    }
    c.canvas.getContext('2d').putImageData(this.img, 0, 0);
    c.dirty = false;

    // Remember the visible water for the animated shimmer: [x, y, hash, shore bits, isSpring].
    c.waterTiles = [];
    if (!c.water) return;
    for (let i = 0; i < CHUNK_AREA; i++) {
      const t = c.type[i];
      if (!isWet(t) || !c.revealed[i]) continue;
      const x = bx + (i & (CHUNK - 1)), y = by + (i >> CHUNK_SHIFT);
      let shore = 0;
      if (!isWet(w.type(x, y - 1))) shore |= 1;
      if (!isWet(w.type(x, y + 1))) shore |= 2;
      if (!isWet(w.type(x - 1, y))) shore |= 4;
      if (!isWet(w.type(x + 1, y))) shore |= 8;
      c.waterTiles.push([x, y, hash(x, y, 77), shore, t === T.SPRING]);
    }
  }

  draw(dt) {
    this.time += dt;
    const { ctx, canvas, game } = this;
    const world = game.world, W = canvas.width, H = canvas.height;
    const left = this.left(), top = this.top();
    const now = game.now();
    this.updateSky(dt);
    this.updateWind();

    // Terrain chunks.
    const cx0 = Math.floor(left / CHUNK_PX), cx1 = Math.floor((left + W) / CHUNK_PX);
    const cy0 = Math.floor(top / CHUNK_PX), cy1 = Math.floor((top + H) / CHUNK_PX);
    let budget = REPAINTS_PER_FRAME;
    const watery = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = world.peekChunk(cx, cy), dx = cx * CHUNK_PX - left, dy = cy * CHUNK_PX - top;
        if (!c) { ctx.drawImage(this.fog, dx, dy); continue; }
        if (!c.canvas) this.paintChunk(c);
        else if (c.dirty && budget > 0) { budget--; this.paintChunk(c); }
        ctx.drawImage(c.canvas, dx, dy);
        c.lastSeen = this.time;
        if (c.waterTiles?.length) watery.push(c);
      }
    }

    this.drawWater(watery, dt, left, top, W, H);
    this.drawCloudShadows(left, top);

    // Sheep and trees, back to front. Trees just below the view can still poke up into it.
    const objs = [];
    for (const s of game.sheep) {
      const sx = Math.round(s.x) - left, sy = Math.round(s.y) - top;
      if (sx > -8 && sy > -8 && sx < W + 8 && sy < H + 8) objs.push([s.y, s]);
    }
    for (let cy = cy0; cy <= cy1 + 1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = world.peekChunk(cx, cy);
        if (!c || !c.trees) continue;
        for (let i = 0; i < CHUNK_AREA; i++) {
          if (c.type[i] !== T.TREE || !c.revealed[i]) continue;
          const x = c.cx * CHUNK + (i & (CHUNK - 1)), y = c.cy * CHUNK + (i >> CHUNK_SHIFT);
          objs.push([y * TILE + 7, x, y, c.extra[i] & 3, treeSpecies(x, y, world.seed, c.biome[i])]);
        }
      }
    }
    objs.sort((a, b) => a[0] - b[0]);
    for (const o of objs) {
      if (o.length === 2) this.drawSheep(o[1], dt, now, left, top, world);
      else {
        const [, x, y, stage, species] = o, t = this.treeSprites[species][stage];
        ctx.drawImage(t.canvas, x * TILE + 4 - t.ax - left, y * TILE + 7 - t.ay - top);
      }
    }

    this.updateSkyClouds(dt, left, top, W, H);
    this.updateBirds(dt, left, top, W, H);
    this.drawSkyCloudShadows(left, top);
    this.drawClouds(dt, left, top);
    this.drawBirds(left, top);
    this.drawSkyClouds(left, top, W, H);
    this.drawSky(dt, left, top);
    this.drawParticles(dt, left, top);
    this.drawHover(left, top);

    // Free caches of chunks that have been off-screen for a while.
    if ((this.time | 0) % 10 === 0 && ((this.time - dt) | 0) % 10 !== 0) {
      for (const c of world.chunks.values()) if (c.canvas && this.time - c.lastSeen > 10) c.canvas = null;
    }
  }

  drawSheep(s, dt, now, left, top, world) {
    const { ctx } = this, lamb = s.isLamb(now);
    const sx = Math.round(s.x) - left, sy = Math.round(s.y) - top;
    const hop = lamb && s.hop && s.state === 'walk' && (s.anim * 6) % 2 < 1 ? 1 : 0;
    ctx.fillStyle = 'rgba(40,30,20,0.25)';
    ctx.fillRect(sx - (lamb ? 2 : 3), sy, lamb ? 4 : 6, 1);
    const set = lamb ? this.lambSprites : this.sheepSprites;
    ctx.drawImage(set[s.look][s.frame()][s.facing > 0 ? 0 : 1], sx - (lamb ? 3 : 4), sy - (lamb ? 4 : 5) - hop);
    if (s.state === 'nap' && (s.anim % 2.5) < dt) {
      this.particles.push({ kind: 'z', x: s.x + 2 * s.facing, y: s.y - 7, vx: 2, vy: -3, life: 2, col: '#f1e8d4' });
    }
    if (s.state === 'graze' && Math.random() < dt * 0.12
        && world.type(s.tileX, s.tileY) === T.FLOWERS) {
      this.particles.push({ kind: 'heart', x: s.x + 3 * s.facing, y: s.y - 7, vx: 0, vy: -4, life: 1.6, col: '#e88aa0' });
    }
  }

  // --- water -------------------------------------------------------------------------

  // Wave crests drift across the water, foam laps at the shore, the sun glints, and now and then
  // something stirs the surface. The still parts (depth, banks, lily pads) live in the chunk cache.
  drawWater(watery, dt, left, top, W, H) {
    const { ctx } = this, t = this.time, day = 1 - this.night;
    const open = [], springs = [];
    for (const c of watery) {
      for (const tile of c.waterTiles) {
        const sx = tile[0] * TILE - left, sy = tile[1] * TILE - top;
        if (sx <= -TILE || sy <= -TILE || sx >= W || sy >= H) continue;
        (tile[4] ? springs : open).push(tile);
      }
    }
    if (!open.length && !springs.length) return;

    // Wave crests: a short light line that stretches, slides a pixel or two, and fades.
    ctx.fillStyle = '#bfe2f8';
    ctx.globalAlpha = 0.55;
    for (const [x, y, h] of open) {
      const ph = (t * 0.45 + ((h >>> 4) & 1023) / 300) % 2.4;
      if (ph >= 1) continue;
      const k = (ph * 4) | 0, len = [1, 2, 3, 2][k];
      const col = 1 + ((h >>> 14) % 3) + (k >> 1), row = 2 + ((h >>> 18) & 3);
      ctx.fillRect(x * TILE + col - left, y * TILE + row - top, Math.min(len, 7 - col), 1);
    }

    // Foam washing up the shore and sliding back.
    ctx.fillStyle = '#f2f8fc';
    for (const [x, y, h, shore] of open) {
      if (!shore) continue;
      const s = Math.sin(t * 1.6 + (h & 255) * 0.1);
      if (s < -0.2) continue;
      ctx.globalAlpha = 0.25 + 0.45 * Math.max(0, s);
      const k = s > 0.5 ? 1 : 2, a = (h >>> 22) % 3, sx = x * TILE - left, sy = y * TILE - top;
      if (shore & 1) { ctx.fillRect(sx + 1 + a, sy + k, 2, 1); ctx.fillRect(sx + 5, sy + k, 2, 1); }
      if (shore & 2) { ctx.fillRect(sx + 1, sy + 7 - k, 2, 1); ctx.fillRect(sx + 4 + a % 2, sy + 7 - k, 2, 1); }
      if (shore & 4) { ctx.fillRect(sx + k, sy + 1 + a, 1, 2); ctx.fillRect(sx + k, sy + 5, 1, 2); }
      if (shore & 8) { ctx.fillRect(sx + 7 - k, sy + 1, 1, 2); ctx.fillRect(sx + 7 - k, sy + 4 + a % 2, 1, 2); }
    }

    // Sun glints, mostly by day.
    ctx.fillStyle = '#ffffff';
    for (const [x, y, h] of open) {
      const ph = (t * 0.7 + ((h >>> 3) & 1023) / 205) % 5;
      if (ph >= 1) continue;
      ctx.globalAlpha = 0.35 + 0.55 * day;
      const len = ph < 0.3 ? 1 : ph < 0.7 ? 2 : 1;
      ctx.fillRect(x * TILE + 2 + ((h >>> 9) % 4) - left, y * TILE + 2 + ((h >>> 12) % 4) - top, len, 1);
    }

    // Springs bubble up in the middle.
    ctx.fillStyle = '#e4f4fd';
    for (const [x, y, h] of springs) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 3 + (h & 31));
      ctx.fillRect(x * TILE + 3 - left, y * TILE + 3 - top, 2, 2);
      if (Math.random() < dt * 1.2) this.ring(x * TILE + 4, y * TILE + 4, 2.5);
    }
    ctx.globalAlpha = 1;

    // Rings from something under the surface, and the odd fish hopping out.
    if (open.length && this.particles.length < MAX_PARTICLES && Math.random() < open.length * dt * 0.02) {
      const [x, y] = pickOne(open), px = x * TILE + 2 + Math.random() * 4, py = y * TILE + 2 + Math.random() * 4;
      if (Math.random() < 0.15 && day > 0.5) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.particles.push({ kind: 'fish', x: px, y: py, vx: dir * 9, vy: -16, life: 0.9, col: '#e8905a' });
      } else this.ring(px, py, 3.5);
    }
  }

  ring(x, y, r) {
    this.particles.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 1.2, max: 1.2, r, col: '#d8eefa' });
  }

  // --- rain clouds ---------------------------------------------------------------------

  cloudSprite(r) {
    const key = Math.round(r * 2);
    if (!this.cloudCache[key]) this.cloudCache[key] = makeCloud(key / 2);
    return this.cloudCache[key];
  }

  cloudAlpha(c) { return clamp(Math.min(c.age * 2, c.life + 1), 0, 1); }

  drawCloudShadows(left, top) {
    const { ctx } = this;
    for (const c of this.game.clouds) {
      const cx = c.x * TILE + 4 - left, cy = c.y * TILE + 4 - top;
      const rx = c.r * TILE * 0.95, ry = rx * 0.45;
      ctx.fillStyle = `rgba(40,50,90,${0.16 * this.cloudAlpha(c)})`;
      for (let dy = -Math.floor(ry); dy <= ry; dy++) {
        const half = Math.round(rx * Math.sqrt(1 - (dy / ry) ** 2));
        ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2, 1);
      }
    }
  }

  drawClouds(dt, left, top) {
    const { ctx } = this;
    for (const c of this.game.clouds) {
      const img = this.cloudSprite(c.r), a = this.cloudAlpha(c);
      const gx = c.x * TILE + 4, gy = c.y * TILE + 4;               // ground centre, world px
      const bob = Math.round(Math.sin(this.time * 1.4 + c.x));
      const x = Math.round(gx - img.width / 2) - left, y = Math.round(gy - CLOUD_HEIGHT - img.height / 2) - top + bob;
      ctx.globalAlpha = a;
      ctx.drawImage(img, x, y);
      ctx.globalAlpha = 1;
      if (c.life <= 0) continue;
      let n = dt * 30 * c.r;
      while (n > 0) {
        if (n >= 1 || Math.random() < n) {
          const ox = (Math.random() * 2 - 1) * c.r * TILE * 0.8;
          const startY = gy - CLOUD_HEIGHT + img.height * 0.3, endY = gy + (Math.random() * 2 - 1) * c.r * TILE * 0.4;
          this.particles.push({ kind: 'drop', x: gx + ox, y: startY, vx: 0, vy: 80, life: (endY - startY) / 80, col: '#8fbfe6' });
        }
        n--;
      }
    }
  }

  // --- sky -------------------------------------------------------------------------------

  updateSky(dt) {
    const target = this.game.skyPhase();
    if (this.phase === null) this.phase = target;
    const diff = ((target - this.phase + 1.5) % 1) - 0.5;  // shortest way round the clock
    this.phase = (this.phase + clamp(diff, -dt / 20, dt / 20) + 1) % 1;
    this.tint = skyTint(this.phase);
    const [r, g, b] = this.tint;
    this.night = clamp((215 - (r + g + b) / 3) / 100, 0, 1);
  }

  // A gentle breeze that slowly swings around; clouds, snow, petals and dust all follow it.
  updateWind() {
    const t = this.time;
    const a = 0.35 + Math.sin(t * 0.013) * 0.9 + Math.sin(t * 0.0047) * 0.6, speed = 5 + 2 * Math.sin(t * 0.031);
    this.wind.x = Math.cos(a) * speed;
    this.wind.y = Math.sin(a) * speed * 0.6;
  }

  updateSkyClouds(dt, left, top, W, H) {
    const M = SKY_CLOUD_MARGIN, x0 = left - M, y0 = top - M, x1 = left + W + M, y1 = top + H + M;
    const fresh = !this.cloudsSeeded;   // the first batch may start in view
    this.cloudsSeeded = true;
    for (const c of this.skyClouds) {
      c.x += this.wind.x * c.speed * dt;
      c.y += this.wind.y * c.speed * dt;
      c.age += dt;
    }
    this.skyClouds = this.skyClouds.filter((c) => {
      const s = this.softClouds[c.v].body;
      return c.x + s.width > x0 && c.x - s.width < x1 && c.y + s.height + 60 > y0 && c.y - s.height < y1;
    });
    // Top up from upwind, out of sight, so clouds drift into view rather than popping in.
    const want = clamp(Math.round(((x1 - x0) * (y1 - y0)) / SKY_CLOUD_AREA), 1, 9);
    const mx = left + W / 2, my = top + H / 2;
    for (let tries = 0; this.skyClouds.length < want && tries < 12; tries++) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      const v = (Math.random() * SKY_CLOUD_VARIANTS) | 0, s = this.softClouds[v].body;
      if (!fresh) {
        const seen = x + s.width / 2 > left && x - s.width / 2 < left + W && y + s.height / 2 > top + SKY_CLOUD_LIFT[1]
          && y - s.height / 2 < top + H;
        if (seen || (x - mx) * this.wind.x + (y - my) * this.wind.y > 0) continue;
      }
      this.skyClouds.push({ x, y, v, speed: 0.8 + Math.random() * 0.6, age: fresh ? 99 : 0 });
    }
  }

  drawSkyCloudShadows(left, top) {
    const { ctx } = this, a = SKY_SHADOW_ALPHA * (1 - this.night);
    if (a < 0.01) return;
    for (const c of this.skyClouds) {
      const s = this.softClouds[c.v].shadow;
      ctx.globalAlpha = a * Math.min(1, c.age / 4);
      ctx.drawImage(s, Math.round(c.x - s.width / 2) - left, Math.round(c.y - s.height / 2) - top);
    }
    ctx.globalAlpha = 1;
  }

  // Clouds are high up, so they slide a little faster than the ground when you pan.
  drawSkyClouds(left, top, W, H) {
    const { ctx } = this;
    for (const c of this.skyClouds) {
      const s = this.softClouds[c.v].body;
      const gx = c.x - left, gy = c.y - top;
      const x = gx + SKY_CLOUD_LIFT[0] + (gx - W / 2) * 0.08 - s.width / 2;
      const y = gy + SKY_CLOUD_LIFT[1] + (gy - H / 2) * 0.08 - s.height / 2;
      ctx.globalAlpha = SKY_CLOUD_ALPHA * (this.dark ? 0.55 : 1) * Math.min(1, c.age / 4);   // softer over dark fog
      ctx.drawImage(s, Math.round(x), Math.round(y));
    }
    ctx.globalAlpha = 1;
  }

  // Every so often by day, a little flock of birds flies over in a loose V.
  updateBirds(dt, left, top, W, H) {
    for (const b of this.birds) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }
    this.birds = this.birds.filter((b) => b.life > 0);
    if (this.birds.length) return;
    this.birdTimer -= dt;
    if (this.birdTimer > 0 || this.night > 0.2) return;
    this.birdTimer = 35 + Math.random() * 70;
    const a = Math.atan2(this.wind.y, this.wind.x) + (Math.random() - 0.5) * 1.4;
    const dx = Math.cos(a), dy = Math.sin(a), speed = 20 + Math.random() * 8, reach = Math.hypot(W, H) / 2 + 30;
    const side = (Math.random() - 0.5) * Math.min(W, H) * 0.7;
    const sx = left + W / 2 - dx * reach - dy * side, sy = top + H / 2 - dy * reach + dx * side;
    const n = 3 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const rank = Math.ceil(i / 2), wing = i % 2 ? 1 : -1;
      this.birds.push({
        x: sx - dx * rank * 5 - dy * wing * rank * 4, y: sy - dy * rank * 5 + dx * wing * rank * 4,
        vx: dx * speed, vy: dy * speed, flap: Math.random() * 6, life: (reach * 2 + 40) / speed,
      });
    }
  }

  drawBirds(left, top) {
    const { ctx } = this;
    if (!this.birds.length) return;
    ctx.fillStyle = 'rgba(30,34,60,0.18)';
    for (const b of this.birds) ctx.fillRect(Math.round(b.x) + 10 - left, Math.round(b.y) + 26 - top, 3, 1);
    ctx.fillStyle = '#3b3a48';
    for (const b of this.birds) {
      const x = Math.round(b.x) - left, y = Math.round(b.y) - top;
      if (Math.sin(this.time * 9 + b.flap) > 0) {      // wings up: a little V
        ctx.fillRect(x, y, 1, 1);
        ctx.fillRect(x + 2, y, 1, 1);
        ctx.fillRect(x + 1, y + 1, 1, 1);
      } else {                                          // wings down
        ctx.fillRect(x + 1, y, 1, 1);
        ctx.fillRect(x, y + 1, 1, 1);
        ctx.fillRect(x + 2, y + 1, 1, 1);
      }
    }
  }

  drawSky(dt, left, top) {
    const [r, g, b] = this.tint;
    if (r + g + b < 765) {
      const { ctx, canvas } = this;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.spawnAmbient(dt, left, top);
  }

  // Life in the air: fireflies and butterflies, falling leaves, and each biome's own weather.
  spawnAmbient(dt, left, top) {
    const night = this.night;
    const W = this.canvas.width, H = this.canvas.height, world = this.game.world;
    if (this.particles.length > MAX_PARTICLES) return;
    const area = (W * H) / 40000;
    const x = left + Math.random() * W, y = top + Math.random() * H;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), t = world.type(tx, ty);
    if (!world.isRevealed(tx, ty)) return;
    const biome = world.biome(tx, ty), green = t === T.GRASS || t === T.MOSS || t === T.FLOWERS;

    // Fireflies over the greenery at night (swamps glow from dusk), butterflies over flowers by day.
    if (night > (biome === B.SWAMP ? 0.12 : 0.3)) {
      if (Math.random() < night * dt * 8 * area && green && this.count('fly') < MAX_FIREFLIES) {
        const life = 3 + Math.random() * 4;
        this.particles.push({
          kind: 'fly', x, y, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4,
          life, max: life, seed: Math.random() * 10, col: '#f6f0a0',
        });
      }
    } else if (night < 0.1 && t === T.FLOWERS && Math.random() < dt * 30 * area
        && this.count('bfly') < MAX_BUTTERFLIES) {
      const life = 6 + Math.random() * 6;
      const col = ['#f2e66b', '#f5f0e8', '#e88aa0', '#b39af0', '#8fc4f0'][(Math.random() * 5) | 0];
      this.particles.push({
        kind: 'bfly', x, y: y - 3, vx: (Math.random() - 0.5) * 8, vy: 0, life, max: life, seed: Math.random() * 10, col,
      });
    }

    // Grown trees let the odd leaf go.
    if (t === T.TREE && (world.extra(tx, ty) & 3) === 3 && Math.random() < dt * 60 * area) {
      const cols = leafColors(treeSpecies(tx, ty, world.seed, biome));
      if (cols) this.drift('leaf', tx * TILE + 1 + Math.random() * 6, ty * TILE - 4 - Math.random() * 6, 2.5, pickOne(cols));
    }

    const r = Math.random();
    if (biome === B.SNOWY || biome === B.TAIGA) {
      if (r < dt * (biome === B.SNOWY ? 40 : 10) * area) this.drift('snow', x, y - 30, 4 + Math.random() * 3, '#f4f8fb');
    } else if (biome === B.CHERRY) {
      if (r < dt * 8 * area) this.drift('leaf', x, y - 24, 4 + Math.random() * 2, pickOne(['#f6c6d2', '#e88aa0', '#fff3f6']));
    } else if (biome === B.DESERT || biome === B.BADLANDS) {
      if (night < 0.5 && r < dt * 6 * area) this.drift('dust', x, y, 1.4, biome === B.DESERT ? '#f2e2b4' : '#e8b088');
    } else if (biome === B.PLAINS) {
      if (night < 0.2 && r < dt * 1.5 * area) this.drift('seed', x, y - 6, 5 + Math.random() * 3, '#fbf8ee');
    }
  }

  drift(kind, x, y, life, col) {
    this.particles.push({ kind, x, y, vx: 0, vy: 0, life, max: life, seed: Math.random() * 10, col });
  }

  count(kind) {
    let n = 0;
    for (const p of this.particles) if (p.kind === kind) n++;
    return n;
  }

  // A raindrop hit the ground: a splash on land, a ring on water.
  landDrop(p) {
    const world = this.game.world, tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (isWet(world.type(tx, ty))) this.ring(p.x, p.y, 2);
    else this.particles.push({ kind: 'splash', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.24, max: 0.24, col: '#bfe0f5' });
  }

  drawParticles(dt, left, top) {
    const { ctx } = this, wind = this.wind;
    const landed = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0 && p.kind === 'drop') landed.push(p);
      if (p.life <= 0 && p.kind === 'fish') this.ring(p.x, p.y, 3);
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of landed) this.landDrop(p);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'dot') p.vy += 30 * dt;
      const x = Math.round(p.x) - left, y = Math.round(p.y) - top;
      ctx.fillStyle = p.col;
      if (p.kind === 'z') {
        ctx.globalAlpha = Math.min(1, p.life);
        ctx.fillRect(x, y, 3, 1);
        ctx.fillRect(x + 1, y + 1, 1, 1);
        ctx.fillRect(x, y + 2, 3, 1);
        ctx.globalAlpha = 1;
      } else if (p.kind === 'fly') {
        const fade = Math.min(1, p.life, (p.max - p.life) * 2);
        ctx.globalAlpha = fade * (0.55 + 0.45 * Math.sin(this.time * 5 + p.seed));
        ctx.fillRect(x, y, 1, 1);
        ctx.globalAlpha *= 0.3;
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y - 1, 1, 3);
        ctx.globalAlpha = 1;
        p.vx += (Math.random() - 0.5) * dt * 6;
        p.vy += (Math.random() - 0.5) * dt * 6;
      } else if (p.kind === 'bfly') {
        // Flutter: wings open and shut, wobbling flight.
        ctx.globalAlpha = Math.min(1, p.life, (p.max - p.life) * 2);
        const open = Math.sin(this.time * 14 + p.seed) > 0;
        ctx.fillRect(x - (open ? 1 : 0), y, open ? 3 : 1, 1);
        ctx.globalAlpha = 1;
        p.vx += (Math.random() - 0.5) * dt * 30;
        p.vx *= 0.98;
        p.vy = Math.sin(this.time * 2 + p.seed) * 4;
      } else if (p.kind === 'heart') {
        ctx.globalAlpha = Math.min(1, p.life);
        ctx.fillRect(x, y, 1, 1);
        ctx.fillRect(x + 2, y, 1, 1);
        ctx.fillRect(x, y + 1, 3, 1);
        ctx.fillRect(x + 1, y + 2, 1, 1);
        ctx.globalAlpha = 1;
      } else if (p.kind === 'drop') {
        ctx.fillRect(x, y, 1, 3);
        ctx.fillStyle = '#d4ebfa';
        ctx.fillRect(x, y + 2, 1, 1);
      } else if (p.kind === 'splash') {
        // Two frames: a little crown, then droplets flicking outward.
        ctx.globalAlpha = 0.9;
        if (p.life > p.max / 2) { ctx.fillRect(x - 1, y - 1, 1, 1); ctx.fillRect(x + 1, y - 1, 1, 1); }
        else { ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1); }
        ctx.globalAlpha = 1;
      } else if (p.kind === 'ring') {
        // An expanding, flattened pixel ring that fades as it grows.
        const k = 1 - p.life / p.max, rr = 1 + k * (p.r - 1), n = Math.max(4, Math.round(rr * 4));
        ctx.globalAlpha = (1 - k) * 0.8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          ctx.fillRect(Math.round(p.x + Math.cos(a) * rr) - left, Math.round(p.y + Math.sin(a) * rr * 0.6) - top, 1, 1);
        }
        ctx.globalAlpha = 1;
      } else if (p.kind === 'fish') {
        p.vy += 36 * dt;
        ctx.fillRect(x, y, 2, 1);
        ctx.fillStyle = '#f6c49a';
        ctx.fillRect(p.vx > 0 ? x + 1 : x, y, 1, 1);
      } else if (p.kind === 'leaf' || p.kind === 'snow' || p.kind === 'seed') {
        // Drifting down (or for seeds, along) on the breeze, swaying side to side.
        const sway = Math.sin(this.time * (p.kind === 'leaf' ? 3 : 1.5) + p.seed);
        const fall = p.kind === 'snow' ? 7 : p.kind === 'leaf' ? 5 : -0.5;
        const carry = p.kind === 'seed' ? 1 : p.kind === 'snow' ? 0.5 : 0.4;
        p.vx = wind.x * carry + sway * (p.kind === 'leaf' ? 6 : 3);
        p.vy = fall + wind.y * carry + (p.kind === 'seed' ? Math.cos(this.time * 1.1 + p.seed) * 2 : 0);
        ctx.globalAlpha = Math.min(1, p.life * 2, (p.max - p.life) * 2);
        ctx.fillRect(x, y, 1, 1);
        if (p.kind === 'leaf' && sway > 0.3) ctx.fillRect(x + 1, y, 1, 1);
        ctx.globalAlpha = 1;
      } else if (p.kind === 'dust') {
        // A wisp of sand skating along with the wind.
        p.vx = wind.x * 4;
        p.vy = wind.y * 4;
        ctx.globalAlpha = 0.5 * Math.min(1, p.life * 2, (p.max - p.life) * 3);
        ctx.fillRect(x, y, 3, 1);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  drawHover(left, top) {
    const h = this.hover;
    if (!h) return;
    const { ctx } = this, x = h.x * TILE - left, y = h.y * TILE - top;
    ctx.fillStyle = h.ok ? 'rgba(255,248,220,0.85)' : 'rgba(192,80,58,0.85)';
    ctx.fillRect(x, y, TILE, 1);
    ctx.fillRect(x, y + TILE - 1, TILE, 1);
    ctx.fillRect(x, y + 1, 1, TILE - 2);
    ctx.fillRect(x + TILE - 1, y + 1, 1, TILE - 2);
  }
}
