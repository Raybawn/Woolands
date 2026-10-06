// Small shared helpers (no DOM).

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function fmt(n) {
  if (n < 10) return n.toFixed(1).replace(/\.0$/, '');
  if (n < 1000) return Math.floor(n).toString();
  const units = ['k', 'M', 'B', 'T', 'Qa', 'Qi'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return (n < 100 ? n.toFixed(1) : Math.floor(n).toString()) + units[u];
}

export function fmtDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m} min`;
  return `${Math.floor(sec)} s`;
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
