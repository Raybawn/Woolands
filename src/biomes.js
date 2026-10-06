// Biomes, Minecraft-style: large temperature and humidity noise fields pick one per tile.
// The middle of every valley is always plains, so the start plays the same in every world.
// Each biome tints the land, picks its own trees and rocks, and changes how easily life takes hold.

import { fbm } from './noise.js';
import { clamp } from './util.js';

export const B = { PLAINS: 0, FOREST: 1, CHERRY: 2, SWAMP: 3, DESERT: 4, BADLANDS: 5, SNOWY: 6, TAIGA: 7 };

// Tree species (see sprites.js): 0 oak, 1 pine, 2 birch, 3 blossom, 4 acacia, 5 snowy pine.
// `trees` are [species, weight] pairs. Plains keeps the original odds, so old valleys look the same.
//
// grow:  multiplier on moss/grass spreading      seeds: multiplier on trees scattering saplings
// moist: starting soil moisture                  rock:  noise threshold for rocks (higher = fewer)
// rockKind: boulder | mossy | stump | cactus | mesa | snowcap
// deco: a little ground detail on bare tiles (bush | puddle | null), every `decoRate` tiles or so
export const BIOMES = [
  {
    id: 'plains', name: 'Plains', grow: 1, seeds: 1, moist: 0, rock: 0.7, rockKind: 'boulder',
    trees: [[3, 1], [1, 5], [2, 4], [0, 10]],
    ground: ['#a08b6d', '#a99476', '#957f63'], damp: ['#86705a', '#8e7861', '#7b6652'], wet: ['#6f5c4a', '#77634f', '#665443'],
    crack: '#7a6650', pebble: '#b3a690', pebbleRate: 9, deco: null,
    rocks: { light: '#a29c94', mid: '#837d76', shade: '#655f59', line: '#48423d' },
    moss: ['#6e7d39', '#7d8c43', '#5d6b30'], grass: ['#5c9a3b', '#67a843', '#4f8a33'], blade: '#86c25a', shadow: '#457c2e',
    petals: ['#f2e66b', '#f5f0e8', '#e88aa0', '#b39af0'],
    water: { deep: '#2c62a4', mid: '#3c7cc0', shallow: '#5a9ad6', ripple: '#6aa6dc', foam: '#cfe6f2', bank: '#24508a' },
  },
  {
    id: 'forest', name: 'Forest', grow: 1.1, seeds: 1.6, moist: 0, rock: 0.68, rockKind: 'stump',
    trees: [[0, 10], [2, 8], [1, 2]],
    ground: ['#7d644a', '#866d52', '#715a42'],
    crack: '#5e4a36', pebble: '#c07a38', pebbleRate: 5, deco: null,
    rocks: { light: '#8f9a84', mid: '#75806c', shade: '#5d6656', line: '#3e4639' },
    moss: ['#5a7a34', '#678a3c', '#4b672b'], grass: ['#478a35', '#52983d', '#3c7a2d'], blade: '#78b452', shadow: '#33682a',
    petals: ['#f5f0e8', '#f2e66b', '#b39af0', '#e8a33d'],
    water: { deep: '#28588e', mid: '#3670a8', shallow: '#5590c4', ripple: '#6aa0cc', foam: '#c6dde8', bank: '#1f4774' },
  },
  {
    id: 'cherry', name: 'Cherry grove', grow: 1, seeds: 1.3, moist: 0, rock: 0.72, rockKind: 'boulder',
    trees: [[3, 14], [2, 3], [0, 3]],
    ground: ['#ab927c', '#b39b86', '#9e866f'],
    crack: '#8a7260', pebble: '#f0b0c4', pebbleRate: 3, deco: null,
    rocks: { light: '#b0a8a4', mid: '#928a86', shade: '#746c69', line: '#524a48' },
    moss: ['#728a40', '#80984a', '#617636'], grass: ['#68a848', '#74b652', '#5a963e'], blade: '#9bd06a', shadow: '#4c8a36',
    petals: ['#f6c6d2', '#e88aa0', '#f5f0e8', '#f6c6d2'],
    water: { deep: '#2e66a8', mid: '#4282c4', shallow: '#62a2da', ripple: '#78b0e0', foam: '#e6eef6', bank: '#25528c' },
  },
  {
    id: 'swamp', name: 'Swamp', grow: 1.25, seeds: 1, moist: 46, rock: 0.72, rockKind: 'mossy',
    trees: [[0, 9], [2, 2]],
    ground: ['#77704f', '#7f7856', '#6c6648'],
    crack: '#4f4a35', pebble: '#8a8458', pebbleRate: 11, deco: 'puddle',
    rocks: { light: '#7d8470', mid: '#666d5b', shade: '#50564a', line: '#363b31' },
    moss: ['#56662f', '#617236', '#4a5828'], grass: ['#4f7c3a', '#5a8942', '#456e32'], blade: '#7aa060', shadow: '#3a5f2c',
    petals: ['#f5f0e8', '#b39af0', '#f2e66b', '#f5f0e8'],
    water: { deep: '#2e5a4c', mid: '#3e6f5c', shallow: '#56876e', ripple: '#6a9a7e', foam: '#a8c4ac', bank: '#26493e' },
  },
  {
    id: 'desert', name: 'Desert', grow: 0.6, seeds: 0.5, moist: 0, rock: 0.73, rockKind: 'cactus',
    trees: [[4, 10]],
    ground: ['#dcc58e', '#e4cf9a', '#cfb680'],
    crack: '#c4a872', pebble: '#efe0b4', pebbleRate: 7, deco: 'bush',
    rocks: { light: '#e6c992', mid: '#cba86e', shade: '#a9864f', line: '#7f6238' },
    moss: ['#8f9a4a', '#9ca856', '#7e8a3e'], grass: ['#86a04a', '#93ad55', '#77903f'], blade: '#b8c870', shadow: '#6a8238',
    petals: ['#f2e66b', '#e8a33d', '#e88aa0', '#f5f0e8'],
    water: { deep: '#2a7aa6', mid: '#3592ba', shallow: '#5cb2cf', ripple: '#78c2da', foam: '#e2f2ee', bank: '#20628a' },
  },
  {
    id: 'badlands', name: 'Badlands', grow: 0.7, seeds: 0.5, moist: 0, rock: 0.68, rockKind: 'mesa',
    trees: [[4, 8], [0, 2]],
    ground: ['#c27a4a', '#cb8553', '#b46f43'],
    crack: '#9a5a35', pebble: '#dca070', pebbleRate: 8, deco: 'bush',
    rocks: { light: '#e0b88e', mid: '#c27448', shade: '#b0603e', line: '#84492f' },
    moss: ['#8a8c44', '#98994e', '#7a7c3a'], grass: ['#94a048', '#a0ac52', '#84903e'], blade: '#c4c070', shadow: '#747c36',
    petals: ['#f2e66b', '#e8a33d', '#f5f0e8', '#f2e66b'],
    water: { deep: '#2c6a98', mid: '#3a80ae', shallow: '#5c9cc4', ripple: '#72aed0', foam: '#e8e4da', bank: '#24527a' },
  },
  {
    id: 'snowy', name: 'Snowy plains', grow: 0.75, seeds: 0.8, moist: 0, rock: 0.7, rockKind: 'snowcap', frost: true,
    trees: [[5, 12], [1, 4], [2, 4]],
    ground: ['#e6ecf1', '#eff4f7', '#d6dfe7'], damp: ['#cdd6de', '#d6dee5', '#c0cad4'], wet: ['#b0bcc8', '#b8c4cf', '#a4b1be'],
    crack: '#c4d0dc', pebble: '#ffffff', pebbleRate: 5, deco: null,
    rocks: { light: '#9ea2aa', mid: '#80858e', shade: '#636872', line: '#454a54' },
    moss: ['#7e9480', '#8aa08b', '#6e8470'], grass: ['#5c967c', '#68a488', '#50866e'], blade: '#d4ecee', shadow: '#456f5e',
    petals: ['#f5f0e8', '#8fc4f0', '#b39af0', '#f5f0e8'],
    water: { deep: '#2e66a6', mid: '#4282c2', shallow: '#6aa4d8', ripple: '#8cc0e8', foam: '#f2f8fc', bank: '#9cb6cc' },
  },
  {
    id: 'taiga', name: 'Taiga', grow: 0.9, seeds: 1.4, moist: 0, rock: 0.69, rockKind: 'mossy',
    trees: [[1, 14], [5, 2], [2, 3]],
    ground: ['#806b52', '#89745a', '#735f48'],
    crack: '#5f4f3c', pebble: '#5a7444', pebbleRate: 6, deco: null,
    rocks: { light: '#959890', mid: '#787b74', shade: '#5e615b', line: '#40433e' },
    moss: ['#58703c', '#647d45', '#4b6133'], grass: ['#4a7f4c', '#558c55', '#406f42'], blade: '#7aaa6e', shadow: '#36603a',
    petals: ['#f5f0e8', '#b39af0', '#8fc4f0', '#f5f0e8'],
    water: { deep: '#2a5c90', mid: '#3a72a8', shallow: '#5890c2', ripple: '#6ea2cc', foam: '#d2e2ec', bank: '#214a76' },
  },
];

// Written to the journal the first time the fog lifts over each biome.
export const BIOME_FOUND = {
  [B.FOREST]: 'The fog drew back from an old forest floor, thick with fallen leaves. Trees seed quickly there.',
  [B.CHERRY]: 'Pink petals drifted out of the fog: a cherry grove lies beyond.',
  [B.SWAMP]: 'The fog lifted over a soggy swamp. The ground there is already damp, so moss spreads easily.',
  [B.DESERT]: 'Warm sand stretches out past the fog. Life takes hold slowly in the desert.',
  [B.BADLANDS]: 'Red rock rose out of the fog: the badlands, dry and striped like a cake.',
  [B.SNOWY]: 'The air turned crisp. Beyond the fog lies a snowy plain.',
  [B.TAIGA]: 'Tall pines loomed in the fog: a quiet taiga.',
};

const CLIMATE_SCALE = 64;    // tiles; roughly how wide a biome is
const HOME = 18;             // always plains within this many tiles of the origin
const HOME_BLEND = 26;       // then biomes fade in over this many tiles

// fbm clusters around 0.5; stretch it so thresholds split the world into fair shares.
const stretch = (v) => clamp((v - 0.5) * 1.8 + 0.5, 0, 1);

export function biomeAt(x, y, seed) {
  const s = CLIMATE_SCALE;
  let temp = stretch(fbm(x / s, y / s, seed ^ 0x7e3a, 3));
  let hum = stretch(fbm(x / s + 31.7, y / s - 12.3, seed ^ 0x4d1c, 3));
  let odd = stretch(fbm(x / 40 - 7.1, y / 40 + 3.3, seed ^ 0x0dd5, 2));
  const k = clamp((Math.hypot(x, y) - HOME) / HOME_BLEND, 0, 1);
  temp = 0.5 + (temp - 0.5) * k;
  hum = 0.4 + (hum - 0.4) * k;
  odd *= k;

  if (temp < 0.32) return hum < 0.5 ? B.SNOWY : B.TAIGA;
  if (temp > 0.68) return odd > 0.62 ? B.BADLANDS : hum > 0.62 ? B.PLAINS : B.DESERT;
  if (hum > 0.7) return B.SWAMP;
  if (odd > 0.68) return B.CHERRY;
  return hum > 0.52 ? B.FOREST : B.PLAINS;
}
