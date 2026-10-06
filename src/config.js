// Woolands – shared constants and tuning knobs.

export const TILE = 8;                 // pixels per tile
export const CHUNK = 16;               // tiles per chunk side
export const CHUNK_SHIFT = 4;          // log2(CHUNK)
export const CHUNK_PX = TILE * CHUNK;  // pixels per chunk side
export const CHUNK_AREA = CHUNK * CHUNK;

export const TICK_HZ = 4;              // simulation ticks per second
export const UPDATES_PER_CHUNK = 10;   // random tile updates per chunk per tick

export const T = { DUST: 0, ROCK: 1, MOSS: 2, GRASS: 3, WATER: 4, SPRING: 5, FLOWERS: 6, TREE: 7 };
export const isLiving = (t) => t === T.MOSS || t === T.GRASS || t === T.FLOWERS || t === T.TREE;
export const isWet = (t) => t === T.WATER || t === T.SPRING;
export const isWalkable = (t) => t === T.DUST || t === T.MOSS || t === T.GRASS || t === T.FLOWERS;
export const isLush = (t) => t === T.GRASS || t === T.FLOWERS;

export const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Moisture (0–255) thresholds.
export const MOIST = { DAMP: 40, WET: 120, GRASS: 50, FROM_GRASS: 30, BLOOM: 90 };

// Growth chances per random update.
export const GROW = {
  DUST_TO_MOSS: 0.08, MOSS_TO_GRASS: 0.04, SHEEP_SEED: 0.15,
  BLOOM: 0.004,       // grass -> flowers (when wet, or next to flowers)
  TREE_STAGE: 0.02,   // sapling -> young -> tree -> old tree
  TREE_SEED: 0.004,   // mature tree drops a sapling nearby
};

export const START_REVEAL = 7;         // fog-free radius around the origin at start
export const REVEAL_RADIUS = 5;        // fog cleared around every living/water tile

export const START_LIFE = 20;
export const INCOME = { moss: 0.05, grass: 0.15, flowers: 0.3, trees: 0.5, water: 0.05 }; // Life/s per tile
export const SHEEP_BONUS = 0.03;       // +3% Life per sheep

export const GRASS_PER_SHEEP = 25;
export const MAX_SHEEP = 150;
export const SHEEP_SPAWN_INTERVAL = 6; // seconds between arrivals
export const SHEEP_SPEED = 5;          // pixels per second
export const LAMB_SPEED = 7;
export const LAMB_MS = 12 * 60 * 1000; // lambs grow up after 12 minutes

export const SPRING_MAX_LEN = 14;      // tiles of stream per spring
export const SPRING_INTERVAL = 4;      // seconds per new stream tile

// Rain clouds you paint with the Rain tool.
export const RAIN = { LINGER: 2, RADIUS: 1.5, MOIST_PER_S: 25, NUDGES_PER_S: 6, MAX_CLOUDS: 10 };

export const ITEMS = {
  moss:    { name: 'Moss',   base: 10,  growth: 1.25 },
  spring:  { name: 'Spring', base: 50,  growth: 1.8 },
  sapling: { name: 'Tree',   base: 150, growth: 1.35 },
};

// Shown in this order, under these headings.
export const UPGRADE_GROUPS = ['Rain', 'Land', 'Flock', 'Calm'];
export const UPGRADES = {
  softRain:    { group: 'Rain',  name: 'Soft rain',       desc: 'Clouds grow wider.',                         base: 40,   growth: 2.3, max: 5 },
  lingering:   { group: 'Rain',  name: 'Lingering rain',  desc: 'Clouds stay 3 seconds longer.',              base: 60,   growth: 2.3, max: 5 },
  nourishing:  { group: 'Rain',  name: 'Nourishing rain', desc: 'Plants under rain grow much faster.',        base: 150,  growth: 2.5, max: 5 },
  richSoil:    { group: 'Land',  name: 'Rich soil',       desc: 'Moss and grass grow 25% faster.',            base: 120,  growth: 2.4, max: 8 },
  deepSprings: { group: 'Land',  name: 'Deep springs',    desc: 'Streams run 6 tiles further.',               base: 200,  growth: 2.8, max: 5 },
  wildflowers: { group: 'Land',  name: 'Wildflowers',     desc: 'Flowers bloom twice as often.',              base: 250,  growth: 2.5, max: 5 },
  oldGrowth:   { group: 'Land',  name: 'Old growth',      desc: 'Saplings grow up 40% faster.',               base: 400,  growth: 2.5, max: 5 },
  seedWind:    { group: 'Land',  name: 'Seed wind',       desc: 'Trees scatter more saplings.',               base: 500,  growth: 2.6, max: 5 },
  morningDew:  { group: 'Land',  name: 'Morning dew',     desc: 'Dawn leaves the ground damp.',               base: 350,  growth: 2.6, max: 4 },
  clearSkies:  { group: 'Land',  name: 'Clear skies',     desc: 'Fog lifts one tile further around life.',    base: 300,  growth: 3,   max: 4 },
  greenHooves: { group: 'Flock', name: 'Green hooves',    desc: 'Sheep leave more moss where they walk.',     base: 250,  growth: 2.6, max: 5 },
  wanderlust:  { group: 'Flock', name: 'Wanderlust',      desc: 'Sheep roam further on their wanders.',       base: 300,  growth: 2.4, max: 5 },
  greenPastures: { group: 'Flock', name: 'Green pastures', desc: 'The valley feeds more sheep.',              base: 350,  growth: 2.7, max: 5 },
  lambing:     { group: 'Flock', name: 'Lambing season',  desc: 'Lambs are born more often.',                 base: 300,  growth: 2.5, max: 4 },
  cozyFlock:   { group: 'Flock', name: 'Cozy flock',      desc: 'Each sheep adds +1% more Life.',             base: 400,  growth: 2.5, max: 5 },
  settling:    { group: 'Calm',  name: 'Settling in',     desc: 'Stillness builds 20% faster.',               base: 350,  growth: 2.5, max: 5 },
  deepCalm:    { group: 'Calm',  name: 'Deep calm',       desc: 'Stillness can build 0.5× higher.',           base: 600,  growth: 3,   max: 6 },
};

// Stillness: builds while you leave the valley alone, multiplies Life.
export const STILL = { TAU: 15 * 60, DISTURB: 0.12, MAX: 3 };
export const WANDER_EVERY = 8 * 60;    // seconds of full stillness per sheep wander
export const MAX_AWAY_WANDERS = 16;    // per absence, so long breaks don't flood the journal
export const FOCUS_LENGTHS = [10, 15, 25, 45, 60, 90]; // minutes
export const DAY_LENGTH = 40 * 60;     // seconds per valley day outside focus sessions
export const JOURNAL_MAX = 120;

export const MAX_OFFLINE = 24 * 3600;  // seconds of catch-up at most
export const OFFLINE_BUDGET = 3e6;     // max random tile updates during catch-up

export const SAVE_KEY = 'woolands.save';
