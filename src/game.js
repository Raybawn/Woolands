// Game state and rules: Life economy, placing things, springs, rain clouds, the flock, Stillness & focus,
// sheep wanders, the journal, the sky clock and offline catch-up.

import {
  T, CHUNK, CHUNK_AREA, DIRS4, ITEMS, UPGRADES, INCOME, SHEEP_BONUS, START_LIFE, START_REVEAL, REVEAL_RADIUS,
  GRASS_PER_SHEEP, MAX_SHEEP, SHEEP_SPAWN_INTERVAL, SPRING_MAX_LEN, SPRING_INTERVAL, GROW, RAIN, LAMB_MS,
  TICK_HZ, UPDATES_PER_CHUNK, MAX_OFFLINE, OFFLINE_BUDGET, STILL, WANDER_EVERY, MAX_AWAY_WANDERS, DAY_LENGTH,
  JOURNAL_MAX, isWet, isWalkable, isLush,
} from './config.js';
import { World, CHUNK_BYTES } from './world.js';
import { simulate, nudge } from './sim.js';
import { Sheep, makeSheep } from './sheep.js';
import { BIOME_FOUND } from './biomes.js';
import { clamp, fmt } from './util.js';

const HINTS = [
  { id: 'start', when: () => true,
    text: 'The valley is only dust. Pick Moss below and tap the ground to plant some.' },
  { id: 'spring', when: (g) => g.bought.moss > 0 && g.bought.spring === 0 && g.life >= g.cost('spring') * 0.7,
    text: 'Moss only spreads into damp ground. A Spring would wet the land around it.' },
  { id: 'grass', when: (g) => g.world.counts.grass >= 5,
    text: 'Grass! Grow enough of it and a sheep might wander in.' },
  { id: 'rainHold', when: (g) => g.world.counts.grass >= 12,
    text: 'Hold down on the ground with Rain selected to let it rain. Drag to move the cloud around.' },
  { id: 'still', when: (g) => g.sheep.length > 0,
    text: 'Leave the valley be and Stillness builds, so more Life flows. Looking around is fine; touching the ground stirs it.' },
  { id: 'upgrades', when: (g) => g.life >= 40 && g.bought.spring > 0,
    text: 'Upgrades are ready. Look for the sparkle in the toolbar.' },
  { id: 'focus', when: (g) => g.sheep.length >= 2,
    text: 'Try a Focus session from the hourglass. While you work, the flock goes wandering.' },
  { id: 'trees', when: (g) => g.world.counts.grass >= 60 && g.bought.sapling === 0,
    text: 'The ground is ready for trees. Sheep love a shady nap, and trees keep the soil damp.' },
];

// What a sheep can come back with. Focus sessions roll on the richer table.
const FINDS = {
  normal: { spring: 8, friend: 10, meadow: 20, grove: 10, seeds: 22, nap: 30 },
  rich:   { spring: 22, friend: 22, meadow: 22, grove: 16, seeds: 18, nap: 0 },
};
const DIRECTIONS = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];

function roll(table) {
  let r = Math.random() * Object.values(table).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(table)) if ((r -= w) < 0) return k;
  return 'nap';
}

export class Game {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.world = new World(seed);
    this.life = START_LIFE;
    this.bought = { moss: 0, spring: 0, sapling: 0 };
    this.upgrades = {};
    this.springs = [];
    this.clouds = [];          // { x, y, r, life, age, vx, vy, acc } – tiles, not saved
    this.sheep = [];
    this.extraSheep = 0;       // sheep that came along as friends, beyond what the land supports
    this.hints = {};
    this.journal = [];         // { t, text, kind }
    this.still = 0;            // 0..1
    this.wanderClock = 0;
    this.focus = null;         // { start, end, minutes } – epoch ms
    this.focusMinutes = 0;
    this.sky = 'valley';       // 'valley' | 'real'
    this.dayPhase = 0.3;       // 0 = midnight, 0.5 = noon
    this.started = Date.now();
    this.lastSaved = Date.now();
    this.view = null;
    this.spawnTimer = SHEEP_SPAWN_INTERVAL;
    this.catchingUp = false;
    this.simNow = null;        // simulated wall-clock during catch-up
    this.listeners = [];
    this.world.reveal(0, 0, START_REVEAL);
    this.world.foundBiomes = [];
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }
  now() { return this.simNow ?? Date.now(); }

  log(text, kind = 'note') {
    const entry = { t: this.now(), text, kind };
    this.journal.push(entry);
    if (this.journal.length > JOURNAL_MAX) this.journal.shift();
    this.emit({ type: 'journal', entry });
  }

  // --- economy --------------------------------------------------------------

  cost(item) {
    const it = ITEMS[item];
    return Math.ceil(it.base * it.growth ** this.bought[item]);
  }

  lvl(id) { return this.upgrades[id] || 0; }

  upgradeCost(id) {
    const u = UPGRADES[id];
    return Math.ceil(u.base * u.growth ** this.lvl(id));
  }

  buyUpgrade(id) {
    const u = UPGRADES[id];
    if (!u || this.lvl(id) >= u.max || this.life < this.upgradeCost(id)) return false;
    this.life -= this.upgradeCost(id);
    this.upgrades[id] = this.lvl(id) + 1;
    this.applyUpgrades();
    if (id === 'deepSprings') {
      for (const s of this.springs) {
        s.max = this.springMax();
        if (s.len < s.max) s.done = false;
      }
    }
    this.emit({ type: 'upgrade', id });
    return true;
  }

  applyUpgrades() {
    this.world.revealRadius = REVEAL_RADIUS + this.lvl('clearSkies');
  }

  springMax() { return SPRING_MAX_LEN + 6 * this.lvl('deepSprings'); }
  stillMax() { return STILL.MAX + 0.5 * this.lvl('deepCalm'); }
  stillMult() { return 1 + (this.stillMax() - 1) * this.still; }
  rainRadius() { return RAIN.RADIUS + 0.5 * this.lvl('softRain'); }
  rainLinger() { return RAIN.LINGER + 3 * this.lvl('lingering'); }

  mods() {
    return {
      grow: 1 + 0.25 * this.lvl('richSoil'),
      flowers: 1 + this.lvl('wildflowers'),
      trees: 1 + 0.4 * this.lvl('oldGrowth'),
      seeds: 1 + 0.6 * this.lvl('seedWind'),
    };
  }

  baseRate() {
    const c = this.world.counts;
    const base = c.moss * INCOME.moss + c.grass * INCOME.grass + c.flowers * INCOME.flowers
      + c.trees * INCOME.trees + c.water * INCOME.water;
    return base * (1 + this.sheep.length * (SHEEP_BONUS + 0.01 * this.lvl('cozyFlock')));
  }

  rate() { return this.baseRate() * this.stillMult(); }

  flockTarget() {
    const c = this.world.counts;
    const pasture = c.grass + c.flowers + c.trees * 2;
    const per = Math.max(10, GRASS_PER_SHEEP - 3 * this.lvl('greenPastures'));
    return Math.min(MAX_SHEEP, Math.floor(pasture / per) + this.extraSheep);
  }

  // --- player actions ---------------------------------------------------------

  // Returns null if placeable, otherwise a short reason.
  whyNot(tool, x, y) {
    const w = this.world;
    if (!w.isRevealed(x, y)) return 'Too foggy over there.';
    const t = w.type(x, y);
    if (tool === 'rain') return null;
    if (tool === 'moss' && t !== T.DUST) return 'Moss needs bare ground.';
    if (tool === 'spring' && !isWalkable(t)) return 'A spring can\'t go there.';
    if (tool === 'sapling') {
      if (t !== T.GRASS && t !== T.MOSS && t !== T.FLOWERS) return 'Trees need grass or moss to root in.';
      if (w.countAround(x, y, 1, T.TREE)) return 'Too close to another tree.';
    }
    if (this.life < this.cost(tool)) return 'Not enough Life yet.';
    return null;
  }

  place(tool, x, y) {
    if (this.whyNot(tool, x, y)) return false;
    const w = this.world;
    this.disturb();
    if (tool === 'rain') return this.rainAt(x, y);
    this.life -= this.cost(tool);
    this.bought[tool]++;
    if (tool === 'moss') {
      w.wet(x, y, 2.5, 60, 8);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const center = !dx && !dy;
          if (w.type(x + dx, y + dy) === T.DUST && w.isRevealed(x + dx, y + dy)
              && (center || Math.random() < 0.6)) {
            w.setType(x + dx, y + dy, T.MOSS);
          }
        }
      }
    } else if (tool === 'spring') {
      this.addSpring(x, y);
    } else if (tool === 'sapling') {
      w.setType(x, y, T.TREE, 0);
      w.wet(x, y, 1.5, 70, 10);
    }
    this.emit({ type: 'place', tool, x, y });
    return true;
  }

  addSpring(x, y) {
    this.world.setType(x, y, T.SPRING);
    this.world.wet(x, y, 5, 250, 40);
    this.springs.push({ x, y, hx: x, hy: y, len: 0, max: this.springMax(), t: 0, done: false });
  }

  // Touching the valley stirs it: Stillness drops a little (looking around doesn't count).
  disturb() { this.still = Math.max(0, this.still - STILL.DISTURB); }

  // --- rain clouds ------------------------------------------------------------------

  // Call repeatedly while the Rain tool is held. Feeds the nearest cloud or makes a new one.
  // (Doesn't disturb Stillness by itself – the UI does that once per gesture.)
  rainAt(x, y) {
    if (!this.world.isRevealed(x, y)) return false;
    const linger = this.rainLinger();
    let c = this.clouds.find((c) => Math.hypot(c.x - x, c.y - y) < 1.8);
    if (c) {
      c.x += (x - c.x) * 0.35;
      c.y += (y - c.y) * 0.35;
      c.life = Math.max(c.life, linger);
      c.r = this.rainRadius();
    } else {
      if (this.clouds.length >= RAIN.MAX_CLOUDS) this.clouds.shift();
      c = {
        x, y, r: this.rainRadius(), life: linger, age: 0, acc: 0,
        vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.12,
      };
      this.clouds.push(c);
    }
    this.world.addMoist(x, y, 4);
    return true;
  }

  isRainingAt(x, y, pad = 0) {
    for (const c of this.clouds) if (Math.hypot(c.x - x, c.y - y) <= c.r + pad) return true;
    return false;
  }

  updateClouds(dt) {
    if (!this.clouds.length) return;
    const w = this.world, m = this.mods();
    m.grow *= 3 + 2 * this.lvl('nourishing');
    m.trees *= 2 + this.lvl('nourishing');
    for (const c of this.clouds) {
      const wet = Math.min(dt, Math.max(0, c.life));
      c.life -= dt;
      c.age += dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.acc += RAIN.MOIST_PER_S * wet;
      const add = Math.floor(c.acc);
      c.acc -= add;
      const R = Math.ceil(c.r), cx = Math.round(c.x), cy = Math.round(c.y);
      if (add > 0) {
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if (Math.hypot(dx, dy) > c.r || !w.isRevealed(cx + dx, cy + dy)) continue;
            w.addMoist(cx + dx, cy + dy, add);
          }
        }
      }
      let n = RAIN.NUDGES_PER_S * c.r * wet;
      while (n > 0) {
        if (n >= 1 || Math.random() < n) {
          const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * c.r;
          const tx = Math.round(c.x + Math.cos(a) * d), ty = Math.round(c.y + Math.sin(a) * d);
          if (w.isRevealed(tx, ty)) nudge(w, tx, ty, m);
        }
        n--;
      }
    }
    this.clouds = this.clouds.filter((c) => c.life > -1); // 1 s to fade out
  }

  // --- focus sessions ---------------------------------------------------------

  startFocus(minutes) {
    const now = Date.now();
    this.focus = { start: now, end: now + minutes * 60000, minutes };
    this.emit({ type: 'focus', state: 'start' });
  }

  cancelFocus() {
    if (!this.focus) return;
    const mins = Math.floor((Date.now() - this.focus.start) / 60000);
    this.dayPhase = this.skyPhase();
    this.focus = null;
    if (mins >= 1) this.log(`You rested with the valley for ${mins} min before stepping away.`, 'focus');
    this.emit({ type: 'focus', state: 'cancel' });
  }

  completeFocus() {
    const f = this.focus;
    this.focus = null;
    this.dayPhase = 0.74; // the session was a day; now the sun sets
    this.focusMinutes += f.minutes;
    this.log(`You focused for ${f.minutes} minutes. The valley rested with you.`, 'focus');
    const trips = Math.max(1, Math.round(f.minutes / 25));
    if (this.sheep.length) {
      for (let i = 0; i < trips; i++) this.wander(true);
    } else {
      const gain = Math.max(25, this.baseRate() * f.minutes * 6);
      this.life += gain;
      this.log(`The dust settled softly while you worked. +${fmt(gain)} Life.`, 'focus');
    }
    this.emit({ type: 'focus', state: 'done', minutes: f.minutes, since: f.start });
  }

  focusProgress() {
    if (!this.focus) return 0;
    return clamp((this.now() - this.focus.start) / (this.focus.end - this.focus.start), 0, 1);
  }

  // --- sky ------------------------------------------------------------------------

  // 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk.
  skyPhase() {
    if (this.sky === 'real') {
      const d = new Date(this.now());
      return (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600) / 24;
    }
    if (this.focus) return 0.27 + this.focusProgress() * (0.74 - 0.27);
    return this.dayPhase;
  }

  isNight() {
    const p = this.skyPhase();
    return p < 0.19 || p > 0.82;
  }

  // --- simulation -----------------------------------------------------------

  tick(dt) {
    this.advance(dt, UPDATES_PER_CHUNK);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SHEEP_SPAWN_INTERVAL;
      if (this.sheep.length < this.flockTarget()) this.addSheep(true);
      this.growLambs();
    }
    this.checkHints();
  }

  // Shared by live ticks and offline catch-up.
  advance(dt, updates) {
    this.life += this.rate() * dt;
    const tau = STILL.TAU / (1 + 0.2 * this.lvl('settling')) / (this.focus ? 2 : 1);
    this.still += (1 - this.still) * (1 - Math.exp(-dt / tau));
    this.growSprings(dt);
    this.updateClouds(dt);
    simulate(this.world, updates, this.mods());
    this.morningDew(dt);
    this.noteBiomes();
    this.dayPhase = (this.dayPhase + dt / DAY_LENGTH) % 1;
    this.wanderClock += dt * this.still;
    if (this.wanderClock >= WANDER_EVERY) {
      this.wanderClock -= WANDER_EVERY;
      const capped = this.catchingUp && this.away.wanders >= MAX_AWAY_WANDERS;
      if (this.sheep.length && !capped) {
        this.wander(false);
        if (this.catchingUp) this.away.wanders++;
      }
    }
    if (this.focus && this.now() >= this.focus.end) this.completeFocus();
  }

  // The fog lifted over a new kind of land: write it down.
  noteBiomes() {
    const found = this.world.foundBiomes;
    while (found.length) {
      const text = BIOME_FOUND[found.shift()];
      if (text) this.log(text, 'biome');
    }
  }

  morningDew(dt) {
    const lv = this.lvl('morningDew'), p = this.skyPhase();
    if (!lv || p < 0.2 || p > 0.32) return;
    for (const c of this.world.chunks.values()) {
      let n = lv * 3 * dt;
      while (n > 0) {
        if (n >= 1 || Math.random() < n) {
          const i = (Math.random() * CHUNK_AREA) | 0;
          // Only soil that already holds a little water; never enough for grass on its own.
          if (c.revealed[i] && c.moist[i] >= 20 && c.moist[i] < 45) {
            c.moist[i] = 45;
            this.world.markDirty(c.cx * CHUNK + (i & (CHUNK - 1)), c.cy * CHUNK + (i >> 4));
          }
        }
        n--;
      }
    }
  }

  growSprings(dt) {
    for (const s of this.springs) {
      if (s.done) continue;
      s.t += dt;
      while (s.t >= SPRING_INTERVAL && !s.done) {
        s.t -= SPRING_INTERVAL;
        this.growSpring(s);
      }
    }
  }

  // Extend the stream one tile, preferring the lowest neighbour so water runs downhill.
  growSpring(s) {
    const w = this.world;
    let best = null, bestE = Infinity;
    for (const [dx, dy] of DIRS4) {
      const nx = s.hx + dx, ny = s.hy + dy, t = w.type(nx, ny);
      if (isWet(t) || t === T.ROCK || t === T.TREE) continue;
      const e = w.elev(nx, ny) + Math.random() * 0.015;
      if (e < bestE) { bestE = e; best = [nx, ny]; }
    }
    if (!best) { s.done = true; return; }
    const [nx, ny] = best;
    w.setType(nx, ny, T.WATER);
    w.wet(nx, ny, 4, 230, 45);
    s.hx = nx;
    s.hy = ny;
    if (++s.len >= s.max) s.done = true;
  }

  onSheepStep(tx, ty) {
    const w = this.world;
    if (w.type(tx, ty) !== T.DUST) return;
    const lv = this.lvl('greenHooves');
    w.addMoist(tx, ty, 6 + 3 * lv);
    if (Math.random() < GROW.SHEEP_SEED * (1 + 0.5 * lv) && w.livingNeighbors(tx, ty) > 0) w.setType(tx, ty, T.MOSS);
  }

  // The flock grows: either a lamb is born, or a sheep finds its way in from the fog.
  addSheep(announce) {
    const now = this.now();
    const adults = this.sheep.filter((s) => !s.isLamb(now));
    if (adults.length >= 2 && Math.random() < 0.3 + 0.1 * this.lvl('lambing')) {
      const mom = adults[(Math.random() * adults.length) | 0];
      const lamb = makeSheep(mom.tileX, mom.tileY, this.sheep);
      lamb.x = mom.x + (Math.random() < 0.5 ? -3 : 3);
      lamb.y = mom.y;
      lamb.born = now;
      lamb.mom = mom.name;
      if (Math.random() < 0.6) lamb.look = mom.look;
      this.sheep.push(lamb);
      if (this.catchingUp) this.away.lambs.push(lamb.name);
      else this.log(`${mom.name} had a lamb! Say hello to little ${lamb.name}.`, 'arrive');
      if (announce) this.emit({ type: 'sheep', sheep: lamb });
      return lamb;
    }
    return this.spawnSheep(announce);
  }

  growLambs() {
    const now = this.now();
    for (const s of this.sheep) {
      if (s.born && now - s.born >= LAMB_MS) {
        s.born = 0;
        if (!this.catchingUp) this.log(`${s.name} has grown into a fine, fluffy sheep.`, 'arrive');
      }
    }
  }

  // A new sheep appears at the edge of the fog and walks toward some grass.
  spawnSheep(announce) {
    const w = this.world;
    const pool = [];
    for (const c of w.chunks.values()) if (c.grass > 0) pool.push(c);
    if (!pool.length) return null;
    for (let tries = 0; tries < 30; tries++) {
      const c = pool[(Math.random() * pool.length) | 0];
      const i = (Math.random() * CHUNK_AREA) | 0;
      if (!isLush(c.type[i])) continue;
      const gx = c.cx * CHUNK + (i & (CHUNK - 1)), gy = c.cy * CHUNK + (i >> 4);
      let sx = gx, sy = gy;
      if (announce) {
        const a = Math.random() * Math.PI * 2;
        for (let d = 1; d < 40; d++) {
          const nx = Math.round(gx + Math.cos(a) * d), ny = Math.round(gy + Math.sin(a) * d);
          if (!w.isRevealed(nx, ny)) break;
          if (isWalkable(w.type(nx, ny))) { sx = nx; sy = ny; }
        }
      }
      const sheep = makeSheep(sx, sy, this.sheep);
      sheep.goTo(gx, gy);
      this.sheep.push(sheep);
      if (this.catchingUp && this.sheep.length > 1) this.away.arrivals.push(sheep.name);
      else this.log(this.sheep.length === 1 ? `A sheep! ${sheep.name} wandered into the valley.`
                                            : `${sheep.name} wandered into the valley and joined the flock.`, 'arrive');
      if (announce) this.emit({ type: 'sheep', sheep });
      return sheep;
    }
    return null;
  }

  // A sheep strolls off into the fog, greening a trail, and maybe finds something.
  wander(rich) {
    const w = this.world, s = this.sheep[(Math.random() * this.sheep.length) | 0];
    const a0 = Math.random() * Math.PI * 2;
    const reach = 10 + 6 * this.lvl('wanderlust') + (rich ? 8 : 0);
    let a = a0, fx = s.tileX, fy = s.tileY, x = fx, y = fy, beyond = 0, trail = 0;
    for (let step = 0; step < 400 && beyond < reach; step++) {
      a += (Math.random() - 0.5) * 0.5;
      const nx = Math.round(fx + Math.cos(a)), ny = Math.round(fy + Math.sin(a)), t = w.type(nx, ny);
      if (t === T.ROCK || t === T.TREE || isWet(t)) { a += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2; continue; }
      fx += Math.cos(a);
      fy += Math.sin(a);
      x = nx;
      y = ny;
      if (beyond || !w.isRevealed(x, y)) beyond++;
      if (beyond && t === T.DUST) {
        w.raiseMoist(x, y, 60);
        if (Math.random() < 0.55) { w.setType(x, y, T.MOSS); trail++; }
      }
    }

    const dir = DIRECTIONS[Math.round(a0 / (Math.PI / 4)) % 8];
    let text = `${s.name} wandered ${dir}${trail ? ', leaving a trail of moss,' : ''}`;
    const find = roll(rich ? FINDS.rich : FINDS.normal);
    const greenPatch = (r, type) => {
      w.wet(x, y, r + 1, 150, 25);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.hypot(dx, dy) <= r + 0.3 && w.type(x + dx, y + dy) === T.DUST) w.setType(x + dx, y + dy, type);
        }
      }
    };
    if (find === 'spring' && isWalkable(w.type(x, y))) {
      this.addSpring(x, y);
      text += ' and found a hidden spring bubbling up from the dust.';
    } else if (find === 'friend') {
      const friend = makeSheep(x, y, this.sheep);
      friend.goTo(s.tileX, s.tileY);
      this.sheep.push(friend);
      this.extraSheep++;
      text += ` and came home with a new friend: ${friend.name}.`;
    } else if (find === 'grove') {
      greenPatch(2, T.GRASS);
      for (let k = 0; k < 2; k++) {
        const tx = x + Math.round((Math.random() * 2 - 1) * 2), ty = y + Math.round((Math.random() * 2 - 1) * 2);
        if (isLush(w.type(tx, ty)) && !w.countAround(tx, ty, 1, T.TREE)) w.setType(tx, ty, T.TREE, 2);
      }
      text += ' and found a little grove, still green after all this time.';
    } else if (find === 'meadow' || find === 'spring') {
      greenPatch(2, Math.random() < 0.5 ? T.FLOWERS : T.GRASS);
      text += ' and found a sheltered hollow where wildflowers still grew.';
    } else if (find === 'seeds') {
      const gain = Math.max(20, this.baseRate() * 120);
      this.life += gain;
      text += ` and came back with burrs full of seeds (+${fmt(gain)} Life).`;
    } else {
      text += ' and napped under the open sky.';
    }
    this.log(text, 'wander');
    this.emit({ type: 'wander', x, y });
  }

  checkHints() {
    for (const h of HINTS) {
      if (this.hints[h.id] || !h.when(this)) continue;
      this.hints[h.id] = true;
      this.emit({ type: 'hint', text: h.text });
      return; // one at a time
    }
  }

  // Simulate time spent away in coarse steps, within a fixed work budget.
  catchUp(seconds) {
    seconds = Math.min(seconds, MAX_OFFLINE);
    const c = this.world.counts;
    const green = () => c.moss + c.grass + c.flowers + c.trees;
    const start = Date.now() - seconds * 1000;
    const before = { life: this.life, green: green(), sheep: this.sheep.length };
    const steps = Math.max(1, Math.min(240, Math.ceil(seconds / 5)));
    const dt = seconds / steps;
    const wanted = seconds * TICK_HZ * UPDATES_PER_CHUNK;
    this.catchingUp = true;
    this.away = { wanders: 0, arrivals: [], lambs: [] };
    for (let i = 0; i < steps; i++) {
      this.simNow = start + (i + 1) * dt * 1000;
      const budget = OFFLINE_BUDGET / Math.max(1, this.world.chunks.size);
      this.advance(dt, Math.min(wanted, budget) / steps);
      while (this.sheep.length < this.flockTarget()) if (!this.addSheep(false)) break;
      this.growLambs();
    }
    const list = (names) => (names.length > 6 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} others` : names.join(', '));
    const { arrivals, lambs } = this.away;
    if (arrivals.length === 1) this.log(`${arrivals[0]} wandered into the valley and joined the flock.`, 'arrive');
    else if (arrivals.length > 1) this.log(`${arrivals.length} sheep found their way into the valley: ${list(arrivals)}.`, 'arrive');
    if (lambs.length === 1) this.log(`A lamb was born while you were away: little ${lambs[0]}.`, 'arrive');
    else if (lambs.length > 1) this.log(`${lambs.length} lambs were born while you were away: ${list(lambs)}.`, 'arrive');
    this.simNow = null;
    this.catchingUp = false;
    return {
      seconds,
      life: this.life - before.life,
      grown: green() - before.green,
      sheep: this.sheep.length - before.sheep,
      still: this.stillMult(),
      entries: this.journal.filter((e) => e.t >= start),
    };
  }

  // --- persistence ----------------------------------------------------------

  toMeta() {
    return {
      v: 3,
      seed: this.world.seed,
      t: Date.now(),
      life: this.life,
      started: this.started,
      bought: this.bought,
      upgrades: this.upgrades,
      springs: this.springs,
      sheep: this.sheep.map((s) => s.toJSON()),
      extraSheep: this.extraSheep,
      hints: this.hints,
      journal: this.journal,
      still: this.still,
      wanderClock: this.wanderClock,
      focus: this.focus,
      focusMinutes: this.focusMinutes,
      sky: this.sky,
      dayPhase: this.dayPhase,
      view: this.view,
    };
  }

  static fromSave({ meta, data }) {
    const g = new Game(meta.seed);
    g.life = meta.life;
    g.lastSaved = meta.t ?? Date.now();
    g.started = meta.started ?? Date.now();
    g.bought = { ...g.bought, ...meta.bought };
    g.upgrades = meta.upgrades ?? {};
    g.springs = meta.springs ?? [];
    g.extraSheep = meta.extraSheep ?? 0;
    g.hints = meta.hints ?? {};
    g.journal = meta.journal ?? [];
    g.still = meta.still ?? 0;
    g.wanderClock = meta.wanderClock ?? 0;
    g.focus = meta.focus ?? null;
    g.focusMinutes = meta.focusMinutes ?? 0;
    g.sky = meta.sky ?? 'valley';
    g.dayPhase = meta.dayPhase ?? 0.3;
    g.view = meta.view ?? null;
    const layers = meta.layers ?? 3, size = (CHUNK_BYTES / 4) * layers;
    meta.chunks.forEach(([cx, cy], n) => g.world.readChunk(cx, cy, data, n * size, layers));
    g.world.recount();
    g.applyUpgrades();
    g.sheep = (meta.sheep ?? []).map((o) => new Sheep(o));
    return g;
  }
}
