// Nature spreading, Minecraft-style: each tick a few random tiles per chunk get a chance to change.
// `m` holds the growth multipliers from upgrades: { grow, flowers, trees, seeds }.

import { CHUNK, CHUNK_SHIFT, CHUNK_AREA, T, MOIST, GROW, DIRS4 } from './config.js';
import { tileIndex } from './world.js';
import { BIOMES } from './biomes.js';

export function simulate(world, perChunk, m) {
  const chunks = Array.from(world.chunks.values());
  for (const c of chunks) {
    let n = Math.floor(perChunk);
    if (Math.random() < perChunk - n) n++;
    const bx = c.cx * CHUNK, by = c.cy * CHUNK;
    for (let k = 0; k < n; k++) {
      const i = (Math.random() * CHUNK_AREA) | 0;
      updateTile(world, c, i, bx + (i & (CHUNK - 1)), by + (i >> CHUNK_SHIFT), m);
    }
  }
}

// One extra growth update for a specific tile (used under rain clouds).
export function nudge(world, x, y, m) {
  const c = world.chunkAt(x, y);
  if (c) updateTile(world, c, tileIndex(x, y), x, y, m);
}

function holdWater(w, x, y) {
  for (const [dx, dy] of DIRS4) w.raiseMoist(x + dx, y + dy, MOIST.FROM_GRASS);
}

function updateTile(w, c, i, x, y, m) {
  const biome = BIOMES[c.biome[i]], grow = m.grow * biome.grow;
  switch (c.type[i]) {
    case T.DUST:
      // Damp dust next to life turns mossy.
      if (c.moist[i] >= MOIST.DAMP && c.revealed[i] && Math.random() < GROW.DUST_TO_MOSS * grow
          && w.livingNeighbors(x, y) > 0) {
        w.setType(x, y, T.MOSS);
      }
      break;
    case T.MOSS:
      if (c.moist[i] >= MOIST.GRASS && Math.random() < GROW.MOSS_TO_GRASS * grow) w.setType(x, y, T.GRASS);
      break;
    case T.GRASS:
      holdWater(w, x, y);
      // Flowers start near water and spread in patches, not carpets.
      if (Math.random() < GROW.BLOOM * m.flowers
          && ((c.moist[i] >= MOIST.BLOOM && Math.random() < 0.15) || (c.moist[i] >= 60 && w.hasNeighbor(x, y, T.FLOWERS)))
          && w.countAround(x, y, 1, T.FLOWERS) < 3) {
        w.setType(x, y, T.FLOWERS);
      }
      break;
    case T.FLOWERS:
      holdWater(w, x, y);
      break;
    case T.TREE: {
      const stage = c.extra[i] & 3;
      if (stage < 3) {
        if (Math.random() < GROW.TREE_STAGE * m.trees) w.setExtra(x, y, stage + 1);
        break;
      }
      // Grown trees keep the soil around them damp and scatter saplings.
      if (Math.random() < 0.15) w.wet(x, y, 2.5, 80, 12);
      if (Math.random() < GROW.TREE_SEED * m.seeds * biome.seeds) {
        const nx = x + Math.round((Math.random() * 2 - 1) * 3), ny = y + Math.round((Math.random() * 2 - 1) * 3);
        const t = w.type(nx, ny);
        if ((t === T.GRASS || t === T.MOSS || t === T.FLOWERS) && w.isRevealed(nx, ny)
            && w.countAround(nx, ny, 1, T.TREE) === 0 && w.countAround(nx, ny, 2, T.TREE) < 3) {
          w.setType(nx, ny, T.TREE, 0);
        }
      }
      break;
    }
  }
}
