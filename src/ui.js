// HUD, toolbar, toasts and dialogs (focus, upgrades, journal, menu, reports).

import { TILE, ITEMS, UPGRADES, UPGRADE_GROUPS, FOCUS_LENGTHS } from './config.js';
import { iconURL } from './sprites.js';
import { LOOKS } from './sheep.js';
import { BIOMES } from './biomes.js';
import { fmt, fmtDuration, fmtClock } from './util.js';

const TOOLS = [
  { id: 'rain', name: 'Rain', key: '1' },
  { id: 'moss', name: 'Moss', key: '2' },
  { id: 'spring', name: 'Spring', key: '3' },
  { id: 'sapling', name: 'Tree', key: '4' },
];

const RAIN_EVERY = 0.1; // seconds between rain pulses while held

const JOURNAL_ICONS = { wander: 'sheep', arrive: 'sheep', focus: 'hourglass', note: 'life', biome: 'compass' };

const SKY_HINTS = {
  valley: 'Each focus session is a day: morning when it starts, sunset when it ends. Otherwise a day lasts 40 minutes.',
  real: 'The valley follows your own clock: night here is night there.',
};

const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtWhen(t) {
  const d = new Date(t), today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

function entryHTML(e) {
  return `<li><img class="icon" alt="" src="${iconURL(JOURNAL_ICONS[e.kind] || 'life')}">`
    + `<time>${fmtWhen(e.t)}</time><span>${esc(e.text)}</span></li>`;
}

export class UI {
  // actions: { exportString(), importString(str), reset() }
  constructor(game, renderer, actions) {
    this.renderer = renderer;
    this.actions = actions;
    this.tool = 'rain';
    this.lastWarn = 0;
    this.rainHold = null;    // { x, y } client coords while the Rain tool is held down
    this.focusLen = 25;
    try { this.focusLen = +localStorage.getItem('woolands.focusLen') || 25; } catch { /* ignore */ }

    for (const img of document.querySelectorAll('img[data-icon]')) img.src = iconURL(img.dataset.icon);
    this.bindTheme();
    this.buildTools();
    this.bindFocus();
    this.bindUpgrades();
    this.bindJournal();
    this.bindMenu();
    for (const d of document.querySelectorAll('dialog')) {
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    }
    window.addEventListener('keydown', (e) => {
      if (e.target.closest('textarea, input') || document.querySelector('dialog[open]')) return;
      const t = TOOLS.find((t) => t.key === e.key);
      if (t) this.select(t.id);
    });
    this.setGame(game);
  }

  setGame(game) {
    this.game = game;
    this.upBuilt = false;
    game.on((ev) => this.onEvent(ev));
    this.update();
  }

  // --- toolbar --------------------------------------------------------------------

  buildTools() {
    const nav = $('tools');
    this.toolEls = {};
    const make = (name, icon) => {
      const b = document.createElement('button');
      b.className = 'tool';
      b.type = 'button';
      b.innerHTML = `<img class="icon" alt=""><span class="name">${name}</span><span class="cost"></span>`;
      b.querySelector('img').src = iconURL(icon);
      nav.appendChild(b);
      return b;
    };
    for (const t of TOOLS) {
      const b = make(t.name, t.id);
      b.title = `${t.name} (${t.key})`;
      b.addEventListener('click', () => this.select(t.id));
      this.toolEls[t.id] = b;
    }
    this.upBtn = make('Upgrades', 'sparkle');
    this.upBtn.addEventListener('click', () => this.openUpgrades());
    this.select(this.tool);
  }

  select(id) {
    this.tool = id;
    for (const [k, el] of Object.entries(this.toolEls)) el.classList.toggle('active', k === id);
    this.hoverAt(null);
  }

  // --- world interaction ----------------------------------------------------------------

  tapAt(clientX, clientY) {
    const g = this.game, r = this.renderer;
    const p = r.screenToWorld(clientX, clientY);
    const near = g.sheep.find((s) => Math.hypot(s.x - p.x, s.y - 3 - p.y) < 5);
    if (near) {
      const mood = { walk: 'ambling along', idle: 'looking around', graze: 'munching', nap: 'napping' }[near.state];
      this.toast(`${near.name}, a ${LOOKS[near.look].name} sheep, is ${mood}.`, 'sheep');
      return;
    }
    const x = Math.floor(p.x / TILE), y = Math.floor(p.y / TILE);
    const why = g.whyNot(this.tool, x, y);
    if (why) {
      const now = performance.now();
      if (now - this.lastWarn > 1500) { this.lastWarn = now; this.toast(why); }
      return;
    }
    g.place(this.tool, x, y);
    this.update();
  }

  // --- held rain -------------------------------------------------------------------------

  rainStart(clientX, clientY) {
    const { x, y } = this.renderer.screenToTile(clientX, clientY);
    if (!this.game.world.isRevealed(x, y)) return;
    this.game.disturb(); // once per gesture, not per drop
    this.rainHold = { x: clientX, y: clientY, acc: RAIN_EVERY };
  }

  rainMove(clientX, clientY) {
    if (!this.rainHold) return this.rainStart(clientX, clientY);
    this.rainHold.x = clientX;
    this.rainHold.y = clientY;
  }

  rainEnd() { this.rainHold = null; }

  // Called every frame by the main loop.
  tickRain(dt) {
    const h = this.rainHold;
    if (!h) return;
    h.acc += dt;
    if (h.acc < RAIN_EVERY) return;
    h.acc = 0;
    const { x, y } = this.renderer.screenToTile(h.x, h.y);
    this.game.rainAt(x, y);
  }

  hoverAt(clientX, clientY) {
    if (clientX == null || this.tool === 'rain') { this.renderer.hover = null; return; }
    const { x, y } = this.renderer.screenToTile(clientX, clientY);
    this.renderer.hover = { x, y, ok: !this.game.whyNot(this.tool, x, y) };
  }

  onEvent(ev) {
    if (this.game.catchingUp) return; // the return report covers it
    if (ev.type === 'hint') this.toast(ev.text, 'life', 7000);
    else if (ev.type === 'journal' && ev.entry.kind !== 'focus') this.toast(ev.entry.text, JOURNAL_ICONS[ev.entry.kind]);
    else if (ev.type === 'focus' && ev.state === 'done') {
      this.showReport({
        title: 'Session complete',
        lines: [`Well done. ${ev.minutes} minutes of focus.`],
        entries: this.game.journal.filter((e) => e.t >= ev.since),
      });
    }
  }

  // --- HUD ---------------------------------------------------------------------------------

  update() {
    const g = this.game;
    $('life').textContent = fmt(g.life);
    $('rate').textContent = `+${fmt(g.rate())}/s`;
    $('flock').textContent = g.sheep.length;
    $('stillBar').style.width = `${Math.round(g.still * 100)}%`;
    $('stillMult').textContent = `×${g.stillMult().toFixed(1)}`;
    for (const t of TOOLS) {
      const el = this.toolEls[t.id], cost = el.querySelector('.cost');
      if (!ITEMS[t.id]) { cost.textContent = 'free'; continue; }
      const c = g.cost(t.id);
      cost.textContent = fmt(c);
      el.classList.toggle('poor', g.life < c);
    }
    const affordable = Object.keys(UPGRADES).filter((id) => g.lvl(id) < UPGRADES[id].max && g.life >= g.upgradeCost(id)).length;
    this.upBtn.querySelector('.cost').textContent = affordable ? `${affordable} ready` : '';
    if ($('upgradesDlg').open) this.fillUpgrades();
    this.updateFocus();
  }

  // Also called from a 1 s timer so the tab title keeps counting while hidden.
  updateFocus() {
    const f = this.game.focus;
    $('focusPill').hidden = !f;
    if (!f) {
      document.title = 'Woolands';
      $('focusIdle').hidden = false;
      $('focusActive').hidden = true;
      return;
    }
    const left = (f.end - Date.now()) / 1000;
    const clock = left > 0 ? fmtClock(left) : 'done';
    $('focusTime').textContent = clock;
    $('focusDlgTime').textContent = clock;
    $('focusBar').style.width = `${Math.round(this.game.focusProgress() * 100)}%`;
    document.title = left > 0 ? `${clock} · Woolands` : '✓ Focus done · Woolands';
    $('focusIdle').hidden = true;
    $('focusActive').hidden = false;
  }

  toast(text, icon = null, ms = 5000) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast panel';
    if (icon) {
      const img = document.createElement('img');
      img.className = 'icon';
      img.src = iconURL(icon);
      img.alt = '';
      el.appendChild(img);
    }
    el.appendChild(document.createTextNode(text));
    box.appendChild(el);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, ms);
  }

  // { title, lines: [], entries: [] }
  showReport({ title, lines, entries }) {
    $('reportTitle').textContent = title;
    $('reportText').innerHTML = lines.map((l) => `<p>${esc(l)}</p>`).join('');
    const shown = entries.slice().sort((a, b) => a.t - b.t).slice(-8).reverse();
    let html = shown.map(entryHTML).join('');
    if (entries.length > shown.length) html += `<li><span></span><span class="hint">…and ${entries.length - shown.length} more in the journal.</span></li>`;
    $('reportList').innerHTML = html;
    if (!$('report').open) $('report').showModal();
  }

  showAwayReport(r) {
    const lines = [`You were gone for ${fmtDuration(r.seconds)}. The valley gathered ${fmt(r.life)} Life.`];
    if (r.grown > 0) lines.push(`${r.grown} patches of ground turned green.`);
    if (r.still > 1.05) lines.push(`Stillness is now ×${r.still.toFixed(1)}.`);
    this.showReport({ title: 'While you were away', lines, entries: r.entries });
  }

  // --- theme ---------------------------------------------------------------------------------

  // 'auto' follows the device; the HUD button flips between light and dark in one tap.
  bindTheme() {
    this.themePref = 'auto';
    try { this.themePref = localStorage.getItem('woolands.theme') || 'auto'; } catch { /* ignore */ }
    this.darkQuery = matchMedia('(prefers-color-scheme: dark)');
    this.darkQuery.addEventListener('change', () => { if (this.themePref === 'auto') this.applyTheme(); });
    $('themeBtn').addEventListener('click', () => this.setTheme(this.isDark ? 'light' : 'dark'));
    for (const c of $('themeChips').children) c.addEventListener('click', () => this.setTheme(c.dataset.theme));
    this.applyTheme();
  }

  setTheme(pref) {
    this.themePref = pref;
    try { localStorage.setItem('woolands.theme', pref); } catch { /* ignore */ }
    this.applyTheme();
  }

  applyTheme() {
    const dark = this.themePref === 'auto' ? this.darkQuery.matches : this.themePref === 'dark';
    const changed = dark !== this.isDark;
    this.isDark = dark;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#2a2730' : '#ddd5c8');
    const btn = $('themeBtn'), label = dark ? 'Light mode' : 'Dark mode';
    btn.querySelector('img').src = iconURL(dark ? 'sun' : 'moon');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    for (const c of $('themeChips').children) c.classList.toggle('active', c.dataset.theme === this.themePref);
    if (changed) this.renderer.setTheme(dark);
  }

  // --- focus ---------------------------------------------------------------------------------

  bindFocus() {
    const chips = $('focusChips');
    for (const m of FOCUS_LENGTHS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = `${m} min`;
      b.dataset.min = m;
      b.addEventListener('click', () => this.pickFocusLen(m));
      chips.appendChild(b);
    }
    this.pickFocusLen(this.focusLen);
    const open = () => { this.updateFocus(); $('focusDlg').showModal(); };
    $('focusBtn').addEventListener('click', open);
    $('focusPill').addEventListener('click', open);
    $('focusStart').addEventListener('click', () => {
      this.game.startFocus(this.focusLen);
      $('focusDlg').close();
      this.updateFocus();
      this.toast(`Focus for ${this.focusLen} minutes. The flock will keep the valley.`, 'hourglass');
    });
    $('focusCancel').addEventListener('click', () => {
      this.game.cancelFocus();
      $('focusDlg').close();
      this.updateFocus();
    });
  }

  pickFocusLen(m) {
    if (!FOCUS_LENGTHS.includes(m)) m = 25;
    this.focusLen = m;
    try { localStorage.setItem('woolands.focusLen', m); } catch { /* ignore */ }
    for (const c of $('focusChips').children) c.classList.toggle('active', +c.dataset.min === m);
  }

  // --- upgrades ------------------------------------------------------------------------------

  bindUpgrades() {
    $('upgradeList').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-up]');
      if (b && this.game.buyUpgrade(b.dataset.up)) {
        this.update();
        this.fillUpgrades();
      }
    });
  }

  openUpgrades() {
    this.fillUpgrades();
    $('upgradesDlg').showModal();
  }

  // Rows are built once in a fixed order (grouped), then only their text and state change,
  // so a button stays put under your finger for repeated buys.
  fillUpgrades() {
    const g = this.game, list = $('upgradeList');
    $('upLife').textContent = fmt(g.life);
    if (!this.upBuilt) {
      this.upBuilt = true;
      list.innerHTML = UPGRADE_GROUPS.map((group) => `<li class="group">${group}</li>`
        + Object.entries(UPGRADES).filter(([, u]) => u.group === group).map(([id, u]) => (
          `<li class="upgrade" data-id="${id}"><span class="name">${u.name}</span>`
          + `<button class="btn primary" type="button" data-up="${id}"></button>`
          + `<span class="desc">${u.desc}</span><span class="pips">${'<i></i>'.repeat(u.max)}</span></li>`
        )).join('')).join('');
    }
    for (const row of list.querySelectorAll('.upgrade')) {
      const id = row.dataset.id, u = UPGRADES[id], lv = g.lvl(id), maxed = lv >= u.max, cost = g.upgradeCost(id);
      const btn = row.querySelector('button');
      const label = maxed ? 'Done' : fmt(cost);
      if (btn.textContent !== label) btn.textContent = label;
      btn.disabled = maxed || g.life < cost;
      btn.classList.toggle('primary', !maxed);
      row.querySelectorAll('.pips i').forEach((pip, i) => pip.classList.toggle('on', i < lv));
    }
  }

  // --- journal -------------------------------------------------------------------------------

  bindJournal() {
    $('journalBtn').addEventListener('click', () => {
      const list = this.game.journal.slice().sort((a, b) => b.t - a.t);
      $('journalList').innerHTML = list.length
        ? list.map(entryHTML).join('')
        : '<li><span></span><span class="empty">Nothing yet. Stories will gather here as the valley grows.</span></li>';
      $('journalDlg').showModal();
    });
  }

  // --- menu ----------------------------------------------------------------------------------

  bindMenu() {
    const menu = $('menu');
    $('menuBtn').addEventListener('click', async () => {
      this.fillStats();
      this.fillSky();
      $('exportText').value = 'Preparing…';
      menu.showModal();
      $('exportText').value = await this.actions.exportString();
    });

    for (const c of $('skyChips').children) {
      c.addEventListener('click', () => {
        this.game.dayPhase = this.game.skyPhase();
        this.game.sky = c.dataset.sky;
        this.fillSky();
      });
    }

    $('copyBtn').addEventListener('click', async () => {
      const ta = $('exportText');
      try { await navigator.clipboard.writeText(ta.value); }
      catch { ta.select(); document.execCommand('copy'); }
      this.toast('Save string copied.');
    });

    if (navigator.share) {
      $('shareBtn').addEventListener('click', () => {
        navigator.share({ title: 'Woolands save', text: $('exportText').value }).catch(() => {});
      });
    } else {
      $('shareBtn').hidden = true;
    }

    $('downloadBtn').addEventListener('click', () => {
      const blob = new Blob([$('exportText').value], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `woolands-${new Date().toISOString().slice(0, 10)}.woolands`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    const doImport = async (text) => {
      if (!text.trim()) return;
      if (!confirm('Replace your current valley with this save?')) return;
      try {
        await this.actions.importString(text);
        menu.close();
        $('importText').value = '';
        this.toast('Valley loaded. Welcome back.', 'sheep');
      } catch (e) {
        this.toast(e.message || 'Could not read that save.');
      }
    };
    $('importBtn').addEventListener('click', () => doImport($('importText').value));
    $('fileInput').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) doImport(await f.text());
    });

    $('resetBtn').addEventListener('click', () => {
      if (!confirm('Leave this valley and start over with bare dust? This cannot be undone.')) return;
      this.actions.reset();
      menu.close();
    });
  }

  fillSky() {
    for (const c of $('skyChips').children) c.classList.toggle('active', c.dataset.sky === this.game.sky);
    $('skyHint').textContent = SKY_HINTS[this.game.sky];
  }

  fillStats() {
    const g = this.game, c = g.world.counts;
    const days = Math.max(1, Math.ceil((Date.now() - g.started) / 86400000));
    const rows = [
      ['Moss', c.moss], ['Grass', c.grass], ['Water', c.water],
      ['Biomes found', `${g.world.seenBiomes.size} of ${BIOMES.length}`], ['Sheep', g.sheep.length], ['Focus time', fmtDuration(g.focusMinutes * 60)], ['Days tending', days],
    ];
    $('stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
}
