# Woolands: design notes

## Purpose
Woolands is a **focus companion**. Leave it alone and it rewards you: Stillness builds, the flock wanders and greens the land, and coming back feels like opening a letter.

## Pillars
- **Cozy, no fail state.** Nature never dies back. There's always a next small thing to watch grow.
- **Hybrid idle.** You choose *what* to place and *roughly where*. Nature spreads on its own from there.
- **The sheep are the score.** They don't produce anything to harvest. A bigger, happier flock means a better valley.
- **Pixel-first.** 8×8 tiles, a small palette, crisp integer scaling.
- **Light.** Runs on phones, idles cheaply, catches up after time away.

## Core loop (milestone 1)
Life (currency) ← every moss, grass and water tile produces it, ×(1 + 3% per sheep).

| Thing | Cost | Effect |
|---|---|---|
| Rain | free | Small moisture boost at the tapped spot (optional poke) |
| Moss | 10 × 1.25ⁿ | 3×3 moss patch plus a little dampness |
| Spring | 50 × 1.8ⁿ | Wets radius 5, then grows a 14-tile stream downhill that wets its banks |

Spreading rules (random ticks):
- Dust with moisture ≥ 40 next to life → moss.
- Moss with moisture ≥ 50 → grass.
- Grass keeps nearby soil slightly damp, but not enough to spread on its own. Water is what drives growth.
- Sheep turn dust they walk on into moss now and then, so the flock slowly pushes the edges outward.

Flock: one sheep per 25 grass tiles. Sheep arrive from the fog edge and each has a name and a wool colour (white / cream / grey / brown / rare black).

## World & fog
- Infinite world in 16×16 chunks, generated from a seed (dust, rocks, elevation for rivers).
- Fog lifts within 5 tiles of any living or water tile. The camera can't go far past the explored area.
- Only existing chunks are simulated or saved. Off-screen chunk images are freed.

## Milestone 2: Focus, sky, upgrades
**Stillness** (0–100%) builds while you leave the valley alone (τ = 15 min, twice as fast during a focus session). Life ×1 → ×3 (raised by Deep calm). Touching the ground (Rain, Moss, Spring) lowers it by 12%. Looking around, zooming and menus don't affect it.

**Wanders.** For every 8 minutes of full Stillness, a random sheep walks into the fog. It leaves a moss trail and may find something: a hidden spring, a new friend (an extra sheep beyond what the grass supports), a grassy hollow, seeds (a lump of Life), or nothing, just a nap. A long absence counts at most 16 wanders, and arrivals while you're away are grouped into a single journal line.

**Focus sessions** (10/15/25/45/60/90 min). The tab title counts down. Finishing a session gives one rich wander per ~25 min (more springs and friends, no empty naps). Ending early is allowed and is logged kindly.

**Sky.** *Valley time* (default): each focus session is one day, with morning at the start and sunset at the end, so your break falls at night. Outside sessions a day lasts 40 min. *Real time* follows your clock. At night the sheep huddle and sleep, and fireflies come out.

**Journal.** Every arrival, wander and session is written down. The return report shows what happened while you were away.

**Upgrades:** Soft rain, Rich soil, Deep springs, Green hooves, Wanderlust, Settling in, Cozy flock, Deep calm. Costs rise ×2.4–3 per level, and each upgrade has a max level.

## Milestone 3: Rain, trees, a livelier flock
**Controls.** With Rain selected: on a mouse, hold the left button to rain under the cursor; on touch, press and hold, then drag to steer the cloud. Right or middle drag pans. A rain gesture lowers Stillness once, not once per raindrop.

**Rain clouds.** Raining makes a pixel cloud that soaks the ground beneath it and gives the plants under it extra growth updates. When you let go, it lingers and drifts (2 s base, +3 s per Lingering rain). Soft rain makes clouds wider, and Nourishing rain makes plants under them grow faster.

**Trees** (the Tree tool, planted on grass or moss). Each tree grows sapling → young → tree → full, about 16 min in total. A full tree keeps the soil around it damp and slowly scatters saplings. There are four species: oak, pine, birch and a rare blossom tree. Trees are drawn as sprites and depth-sorted with the sheep.

**Flowers.** Grass near water blooms now and then, and flowers spread into patches (never carpets). Butterflies flutter over them by day.

**Flock life.**
- Sheep drink at the water, nap in tree shade around midday, and shelter on the north side of trees when it rains, tucked under the canopy.
- Lambs are born (30% of new sheep, more with Lambing season), trot and skip after their mothers, and grow up after 12 min.
- Hearts float up when a sheep grazes among flowers.

**Upgrades** are listed in a fixed order under Rain, Land, Flock and Calm, and buying one updates its row in place. New in this milestone: Lingering rain, Nourishing rain, Wildflowers, Old growth, Seed wind, Morning dew, Clear skies, Green pastures, Lambing season.

## Milestone 4: Biomes and a livelier sky
**Biomes.** Like Minecraft, two large noise fields (temperature and humidity, plus a third for rare biomes) pick a biome per tile. The start of every valley is always plains; other biomes fade in from about 18 tiles out. Biomes are regenerated from the seed, so saves don't change.

| Biome | Ground | Rocks | Trees | Effect |
|---|---|---|---|---|
| Plains | dust | boulders | oak, pine, birch, rare blossom | — |
| Forest | dark loam, fallen leaves | boulders, stumps | oak, birch | grows ×1.1, trees seed ×1.6 |
| Cherry grove | warm dust, petals | boulders | mostly blossom | trees seed ×1.3 |
| Swamp | mud, puddles | mossy boulders | oak | starts damp, grows ×1.25; lily pads, murky water, fireflies from dusk |
| Desert | sand, dead bushes | cacti, sandstone | acacia | grows ×0.6 |
| Badlands | red sand | striped mesa rock | acacia | grows ×0.7 |
| Snowy plains | snow | snow-capped boulders | snowy pine | grows ×0.75; frosted grass, ice floes |
| Taiga | podzol | mossy boulders | pine | grows ×0.9, trees seed ×1.4 |

Biome borders are dithered rather than hard tile seams. The first time the fog lifts over a new biome, the journal says so.

**Sky and weather.** Soft pixel clouds drift high over the valley on a slowly turning breeze and cast shadows on the ground. Small flocks of birds fly over by day. Each biome has its own air: snow in the cold, petals in cherry groves, sand wisps in the desert, dandelion fluff on the plains, and leaves falling from full-grown trees.

**Rain clouds** are now outlined slate-blue pixel clouds with shaded puffs. Raindrops splash on land and ring on water.

**Water.** Depth is shaded from the real distance to the shore (foam, shallows, open water, deep water), outer corners are rounded, and the north bank casts a shadow. Wave crests drift, foam laps at the shore, the sun glints, springs bubble, and the odd fish jumps.

## Roadmap ideas
- **More nature:** bushes and berries, bees and birds, ponds. A Harmony bonus for good neighbours. Some plants that only come from wanders.
- **Flock life.** Sheep traits (sleepy, explorer, flower lover), lambs, a flock book, rare variants.
- **Gentle events.** Rain clouds to tap, seed-carrying birds.
- **Sound.** Ambient loops and a soft chime when a session ends; an optional browser notification.
- **PWA.** Installable, works offline, protects saves from iOS storage eviction.
- **Prestige: "The next valley".** The flock migrates, and old valleys go into an atlas.
- Self-host the font for offline use, and maybe pick a pixel font with a clearer "5".
