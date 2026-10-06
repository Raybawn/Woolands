// Entry point: load or start a valley, run the loop, autosave.

import { TICK_HZ } from './config.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { setupInput } from './input.js';
import { loadLocal, saveLocal, saveLocalSync, clearLocal, encodeSave, decodeSave } from './save.js';

const AUTOSAVE_MS = 30_000;
const FRAME_MIN = 1 / 30;     // cap drawing at ~30 fps
const REPORT_AFTER = 60;      // seconds away before showing "while you were away"

const worthReporting = (r) => r.seconds >= REPORT_AFTER || r.entries.some((e) => e.kind === 'focus');

let game = await loadLocal();
let report = null;
if (game) {
  const away = (Date.now() - game.lastSaved) / 1000;
  if (away > 2) report = game.catchUp(away);
} else {
  game = new Game();
}

const canvas = document.getElementById('world');
const renderer = new Renderer(canvas, game);

const swap = (next) => {
  game = next;
  renderer.setGame(game);
  ui.setGame(game);
  save();
};

const ui = new UI(game, renderer, {
  exportString: () => { game.view = renderer.viewState(); return encodeSave(game); },
  importString: async (str) => swap(await decodeSave(str)),
  reset: () => { clearLocal(); swap(new Game()); },
});
setupInput(canvas, renderer, ui);
window.woolands = { get game() { return game; }, renderer, ui }; // console access for tinkering
if (report && worthReporting(report)) ui.showAwayReport(report);

function save() {
  game.view = renderer.viewState();
  return saveLocal(game);
}

setInterval(save, AUTOSAVE_MS);
setInterval(() => ui.updateFocus(), 1000); // keeps the tab title ticking even when hidden
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', () => { game.view = renderer.viewState(); saveLocalSync(game); });
window.addEventListener('resize', () => renderer.resize());

// --- main loop ---------------------------------------------------------------------

const STEP = 1 / TICK_HZ;
let last = performance.now(), acc = 0, drawAcc = 0, uiAcc = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 5) {
    // Tab was hidden or the device slept: catch up in one go.
    const r = game.catchUp(dt);
    if (worthReporting(r)) ui.showAwayReport(r);
    dt = 0;
  }
  dt = Math.min(dt, 0.25);

  ui.tickRain(dt);
  acc += dt;
  while (acc >= STEP) {
    game.tick(STEP);
    acc -= STEP;
  }

  drawAcc += dt;
  if (drawAcc >= FRAME_MIN) {
    for (const s of game.sheep) s.update(drawAcc, game);
    renderer.draw(drawAcc);
    drawAcc = 0;
  }

  uiAcc += dt;
  if (uiAcc >= 0.25) {
    ui.update();
    uiAcc = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
