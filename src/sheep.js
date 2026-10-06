// Tiny sheep: they wander, graze, drink, nap in the shade, hide from rain under trees –
// and fertilise the dust they walk over. Lambs trot after their mothers.

import { TILE, T, SHEEP_SPEED, LAMB_SPEED, LAMB_MS, isWalkable, isWet } from './config.js';

const NAMES = [
  'Clover', 'Bramble', 'Puff', 'Biscuit', 'Nettle', 'Pebble', 'Thistle', 'Wisp', 'Fennel', 'Button',
  'Mallow', 'Juniper', 'Dot', 'Barley', 'Sorrel', 'Tumble', 'Fern', 'Cobble', 'Mossy', 'Nimbus',
  'Pip', 'Hazel', 'Crumble', 'Willow', 'Sprout', 'Bean', 'Marigold', 'Flint', 'Dandelion', 'Cotton',
  'Rosie', 'Oats', 'Bumble', 'Heather', 'Mochi', 'Pudding', 'Sage', 'Teasel', 'Poppy', 'Wooly',
  'Acorn', 'Bluebell', 'Cloudy', 'Daisy', 'Ember', 'Figgy', 'Gumdrop', 'Honey', 'Ivy', 'Jellybean',
  'Kipper', 'Lentil', 'Muffin', 'Noodle', 'Olive', 'Parsnip', 'Quill', 'Rhubarb', 'Snowdrop', 'Toffee',
];

// Wool colours: white, cream, grey, brown, black. Weights sum to 100.
export const LOOKS = [
  { name: 'white', weight: 70 },
  { name: 'cream', weight: 15 },
  { name: 'grey',  weight: 9 },
  { name: 'brown', weight: 4 },
  { name: 'black', weight: 2 },
];

function rollLook() {
  let r = Math.random() * 100;
  for (let i = 0; i < LOOKS.length; i++) {
    r -= LOOKS[i].weight;
    if (r < 0) return i;
  }
  return 0;
}

function pickName(taken) {
  const free = NAMES.filter((n) => !taken.has(n));
  if (free.length) return free[(Math.random() * free.length) | 0];
  const base = NAMES[(Math.random() * NAMES.length) | 0];
  let n = 2;
  while (taken.has(`${base} ${toRoman(n)}`)) n++;
  return `${base} ${toRoman(n)}`;
}

function toRoman(n) {
  const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s;
}

export function makeSheep(tx, ty, flock) {
  const taken = new Set(flock.map((s) => s.name));
  return new Sheep({ x: tx * TILE + 4, y: ty * TILE + 6, name: pickName(taken), look: rollLook() });
}

const ACCEPT = { [T.GRASS]: 1, [T.FLOWERS]: 1, [T.MOSS]: 0.5, [T.DUST]: 0.15 };
const rnd = (r) => Math.round((Math.random() * 2 - 1) * r);

// Nearest tile matching `test` within radius r (square scan), or null.
function findNear(w, x, y, r, test) {
  let best = null, bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!test(x + dx, y + dy)) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = [x + dx, y + dy]; }
    }
  }
  return best;
}

export class Sheep {
  constructor(o) {
    this.x = 0;              // feet position, world pixels
    this.y = 0;
    this.name = 'Sheep';
    this.look = 0;
    this.born = 0;           // epoch ms if born in the valley as a lamb (0 = grown up)
    this.mom = null;         // mother's name, for lambs
    this.state = 'idle';     // walk | idle | graze | drink | nap
    this.goal = null;        // what to do on arrival: drink | nap | shelter
    this.hop = false;        // lambs skip along sometimes
    this.timer = Math.random() * 2;
    this.tx = 0;
    this.ty = 0;
    this.facing = 1;
    this.anim = Math.random() * 10;
    this.lastTile = '';
    Object.assign(this, o);
  }

  get tileX() { return Math.floor(this.x / TILE); }
  get tileY() { return Math.floor(this.y / TILE); }

  isLamb(now) { return this.born > 0 && now - this.born < LAMB_MS; }

  goTo(tx, ty, goal = null) {
    this.tx = tx * TILE + 2 + Math.random() * 4;
    this.ty = ty * TILE + 3 + Math.random() * 4;
    this.state = 'walk';
    this.goal = goal;
  }

  frame() {
    if (this.state === 'walk') return (this.anim * 4) % 2 < 1 ? 'walkA' : 'walkB';
    if (this.state === 'graze') return (this.anim * 0.7) % 3 < 2 ? 'graze' : 'idle';
    if (this.state === 'drink') return 'graze';
    return this.state;
  }

  update(dt, game) {
    this.anim += dt;
    if (this.state !== 'walk') {
      this.timer -= dt;
      // Caught in the rain? Head for a tree.
      if (this.goal !== 'shelter' && this.state !== 'nap' && game.isRainingAt(this.tileX, this.tileY)) this.timer = 0;
      if (this.timer <= 0) {
        if (this.goal === 'shelter' && game.isRainingAt(this.tileX, this.tileY, 2)) this.timer = 2;
        else this.wander(game);
      }
      return;
    }
    const lamb = this.isLamb(game.now());
    const dx = this.tx - this.x, dy = this.ty - this.y, d = Math.hypot(dx, dy);
    if (d < 0.5) {
      this.rest(game.isNight());
      return;
    }
    const step = Math.min(d, (lamb ? LAMB_SPEED : SHEEP_SPEED) * dt);
    const nx = this.x + (dx / d) * step, ny = this.y + (dy / d) * step;
    const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
    if (!isWalkable(game.world.type(tx, ty))) {
      this.state = 'idle';
      this.goal = null;
      this.timer = 1 + Math.random() * 2;
      return;
    }
    if (Math.abs(dx) > 0.3) this.facing = dx > 0 ? 1 : -1;
    this.x = nx;
    this.y = ny;
    const key = tx + ',' + ty;
    if (key !== this.lastTile) {
      this.lastTile = key;
      game.onSheepStep(tx, ty);
    }
  }

  rest(night) {
    const goal = this.goal;
    this.goal = goal === 'shelter' ? 'shelter' : null;
    this.hop = false;
    if (goal === 'drink') { this.state = 'drink'; this.timer = 4 + Math.random() * 4; return; }
    if (goal === 'nap') { this.state = 'nap'; this.timer = 20 + Math.random() * 25; return; }
    if (goal === 'shelter') { this.state = 'idle'; this.timer = 3; return; }
    const r = Math.random();
    if (night && r < 0.7) { this.state = 'nap'; this.timer = 30 + Math.random() * 40; }
    else if (r < 0.55) { this.state = 'graze'; this.timer = 3 + Math.random() * 6; }
    else if (r < 0.9) { this.state = 'idle'; this.timer = 1.5 + Math.random() * 3; }
    else { this.state = 'nap'; this.timer = 12 + Math.random() * 20; }
  }

  wander(game) {
    const w = game.world, x = this.tileX, y = this.tileY, night = game.isNight();
    this.goal = null;

    // Raining here: tuck in on the north side of the nearest tree, under its canopy.
    if (game.isRainingAt(x, y, 1)) {
      const spot = findNear(w, x, y, 7, (ax, ay) => w.type(ax, ay + 1) === T.TREE && w.extra(ax, ay + 1) >= 2
        && isWalkable(w.type(ax, ay)));
      if (spot) { this.goTo(spot[0], spot[1], 'shelter'); return; }
    }

    // Lambs stay close to mum, often skipping.
    if (this.isLamb(game.now())) {
      const mom = game.sheep.find((s) => s.name === this.mom);
      if (mom) {
        const tx = mom.tileX + rnd(1), ty = mom.tileY + rnd(1);
        if (isWalkable(w.type(tx, ty))) {
          this.goTo(tx, ty);
          this.hop = Math.random() < 0.5;
          return;
        }
      }
    }

    const r = Math.random(), phase = game.skyPhase();
    if (!night && r < 0.12) {
      // A drink by the water.
      const spot = findNear(w, x, y, 6, (ax, ay) => isWalkable(w.type(ax, ay)) && w.isRevealed(ax, ay)
        && (isWet(w.type(ax + 1, ay)) || isWet(w.type(ax - 1, ay)) || isWet(w.type(ax, ay + 1))));
      if (spot) { this.goTo(spot[0], spot[1], 'drink'); return; }
    } else if (!night && phase > 0.4 && phase < 0.62 && r < 0.25) {
      // Midday nap in the shade.
      const spot = findNear(w, x, y, 7, (ax, ay) => w.type(ax, ay + 1) === T.TREE && w.extra(ax, ay + 1) >= 2
        && isWalkable(w.type(ax, ay)));
      if (spot) { this.goTo(spot[0], spot[1], 'nap'); return; }
    }

    for (let tries = 0; tries < 12; tries++) {
      // Sometimes drift toward a flock-mate so they stay loosely together.
      let bx = x, by = y;
      if (game.sheep.length > 1 && Math.random() < (night ? 0.8 : 0.3)) {
        const o = game.sheep[(Math.random() * game.sheep.length) | 0];
        bx = o.tileX;
        by = o.tileY;
      }
      const tx = bx + rnd(night ? 2 : 5), ty = by + rnd(night ? 2 : 5);  // at night they huddle up
      const t = w.type(tx, ty);
      if (!isWalkable(t) || !w.isRevealed(tx, ty)) continue;
      if (Math.random() < (ACCEPT[t] ?? 0)) {
        this.goTo(tx, ty);
        return;
      }
    }
    this.state = 'idle';
    this.timer = 2;
  }

  toJSON() {
    return { x: Math.round(this.x), y: Math.round(this.y), name: this.name, look: this.look, born: this.born, mom: this.mom };
  }
}
