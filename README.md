# Woolands

A cozy idle game: bring a barren, foggy valley back to life so tiny sheep can thrive in it.
Plain HTML/CSS/JS (ES modules). No build step and no dependencies.

## Run locally

ES modules don't load from `file://`, so serve the folder with any static server:

```sh
python -m http.server 8000      # or: npx serve
```

Then open http://localhost:8000.

## Deploy

Upload the folder as static files: `index.html`, `style.css` and `src/`. Your own domain, GitHub Pages, Netlify and Cloudflare Pages all work. No server code is needed.

## Controls

- **Tap / click** to place the selected thing. Tap a sheep to meet it.
- **Rain:** hold the left mouse button, or press and hold on touch, and drag to steer the cloud.
- **Pan:** drag with one finger, left-drag (tools other than Rain), or right/middle-drag with a mouse.
- **Zoom:** pinch or mouse wheel. Keys 1–4 pick tools.
- **Dark mode:** the moon/sun button next to the menu. Menu → Look sets Auto (follows your device), Light or Dark.

## Saving

- Autosaves to `localStorage` every 30 s and whenever the tab is hidden or closed.
- **Menu → Take your valley with you** gives you a save string (`WL1.…`) to copy, share or download. Paste it into **Load a valley** on another device.
- Format: game state → binary → deflate (`CompressionStream`) → base64url, plus a checksum. Terrain is regenerated from the world seed, so only touched chunks are stored. A young valley comes to about 2 KB.

## Code map

| File | What it does |
|---|---|
| `src/config.js` | All tuning numbers: growth rates, costs, income, sheep |
| `src/world.js` | Infinite chunked tile world, moisture, fog reveal |
| `src/biomes.js` | Biome map (temperature/humidity noise), per-biome palettes, trees, rocks and growth rates |
| `src/sim.js` | Random-tick spreading rules (dust → moss → grass) |
| `src/game.js` | Economy, placing, springs/rivers, flock, Stillness, focus sessions, wanders, journal, sky clock, offline catch-up |
| `src/sheep.js` | Sheep behaviour and names |
| `src/sprites.js` | Procedural pixel art (tiles, sheep, icons) |
| `src/render.js` | Low-res canvas, camera/zoom, per-chunk render cache, water shimmer, sky clouds, birds, weather particles, day/night tint |
| `src/input.js` | Drag to pan, pinch/wheel to zoom, tap |
| `src/ui.js` | HUD, toolbar, toasts, focus/upgrades/journal/menu dialogs |
| `src/save.js` | Save strings and localStorage |
| `src/util.js` | Number/time formatting |

For debugging in the browser console: `woolands.game` (e.g. `woolands.game.life = 1e4`).
