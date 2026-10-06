// Pointer input for mouse, touch and pen.
//
// Mouse: left click places / left-drag pans; with Rain, holding the left button rains under the cursor.
//        Right or middle drag always pans. Wheel zooms.
// Touch: tap places; drag pans; with Rain, press and hold (without moving) starts the rain, then drag
//        to steer the cloud. Two fingers pinch-zoom and pan.

const TAP_SLOP = 8;   // CSS px a pointer may move and still count as a tap
const HOLD_MS = 260;  // touch: hold this long to start raining

export function setupInput(canvas, renderer, ui) {
  const pts = new Map();
  // mode: 'pending' (tap or drag not decided), 'pan', 'rain', 'pinch'
  let mode = null, start = null, holdTimer = 0, pinch = null;

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const clearHold = () => { clearTimeout(holdTimer); holdTimer = 0; };
  const stopRain = () => { if (mode === 'rain') ui.rainEnd(); };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pts.size === 2) {
      // Second finger: whatever the first was doing becomes a pinch.
      clearHold();
      stopRain();
      const [a, b] = [...pts.values()];
      mode = 'pinch';
      pinch = { d: dist(a, b) || 1, scale: renderer.scale, mid: mid(a, b) };
      return;
    }
    if (pts.size > 2) return;

    start = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) {
      e.preventDefault();
      mode = 'pan';
    } else if (e.pointerType === 'mouse' && ui.tool === 'rain') {
      mode = 'rain';
      ui.rainStart(e.clientX, e.clientY);
    } else {
      mode = 'pending';
      if (e.pointerType !== 'mouse' && ui.tool === 'rain') {
        holdTimer = setTimeout(() => {
          if (mode !== 'pending') return;
          mode = 'rain';
          const p = pts.get(e.pointerId);
          ui.rainStart(p.x, p.y);
        }, HOLD_MS);
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (e.pointerType === 'mouse') ui.hoverAt(e.clientX, e.clientY);
    if (!p) return;
    const prev = { x: p.x, y: p.y };
    p.x = e.clientX;
    p.y = e.clientY;

    if (mode === 'pinch' && pts.size === 2) {
      const [a, b] = [...pts.values()], m = mid(a, b);
      renderer.panBy(m.x - pinch.mid.x, m.y - pinch.mid.y);
      pinch.mid = m;
      renderer.zoomAt((pinch.scale * dist(a, b)) / pinch.d, m.x, m.y);
    } else if (mode === 'rain') {
      ui.rainMove(p.x, p.y);
    } else if (mode === 'pending' && Math.hypot(p.x - start.x, p.y - start.y) > TAP_SLOP) {
      clearHold();
      mode = 'pan';
      renderer.panBy(p.x - start.x, p.y - start.y);
    } else if (mode === 'pan') {
      renderer.panBy(p.x - prev.x, p.y - prev.y);
    }
  });

  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size > 0) return; // wait until every finger is up
    clearHold();
    if (mode === 'pending' && e.type === 'pointerup') ui.tapAt(e.clientX, e.clientY);
    stopRain();
    mode = null;
    pinch = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') ui.hoverAt(null); });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = Math.max(1, Math.round(renderer.dpr / 2));
    renderer.zoomAt(renderer.scale + (e.deltaY < 0 ? step : -step), e.clientX, e.clientY);
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll
}
