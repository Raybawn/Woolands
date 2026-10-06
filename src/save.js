// Save strings: game state -> binary -> deflate -> base64url, with a checksum.
// Format: "WL1.<data>.<checksum>" (compressed) or "WL0.<data>.<checksum>" (raw, used for quick sync saves).

import { SAVE_KEY } from './config.js';
import { CHUNK_BYTES, LAYERS } from './world.js';
import { Game } from './game.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function pack(game) {
  const meta = game.toMeta();
  const chunks = [...game.world.chunks.values()];
  meta.chunks = chunks.map((c) => [c.cx, c.cy]);
  meta.layers = LAYERS;
  const mb = enc.encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + mb.length + chunks.length * CHUNK_BYTES);
  new DataView(out.buffer).setUint32(0, mb.length);
  out.set(mb, 4);
  let off = 4 + mb.length;
  for (const c of chunks) {
    game.world.writeChunk(c, out, off);
    off += CHUNK_BYTES;
  }
  return out;
}

function unpack(bytes) {
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const meta = JSON.parse(dec.decode(bytes.subarray(4, 4 + n)));
  return { meta, data: bytes.subarray(4 + n) };
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const s = atob(str);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function checksum(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(36);
}

const wrap = (tag, bytes) => `${tag}.${toB64(bytes)}.${checksum(bytes)}`;

export async function encodeSave(game) {
  const raw = pack(game);
  if (typeof CompressionStream === 'undefined') return wrap('WL0', raw);
  return wrap('WL1', await pipe(raw, new CompressionStream('deflate')));
}

export function encodeSaveSync(game) {
  return wrap('WL0', pack(game));
}

export async function decodeSave(str) {
  const [tag, b64, sum] = str.replace(/\s+/g, '').split('.');
  if (!b64 || !sum || !/^WL\d$/.test(tag)) throw new Error('That doesn\'t look like a Woolands save.');
  let bytes;
  try { bytes = fromB64(b64); } catch { throw new Error('That save string is damaged.'); }
  if (checksum(bytes) !== sum) throw new Error('That save string is incomplete or damaged.');
  let raw;
  if (tag === 'WL1') raw = await pipe(bytes, new DecompressionStream('deflate'));
  else if (tag === 'WL0') raw = bytes;
  else throw new Error('This save is from a newer version of Woolands.');
  return Game.fromSave(unpack(raw));
}

// --- local storage -----------------------------------------------------------

export async function saveLocal(game) {
  try { localStorage.setItem(SAVE_KEY, await encodeSave(game)); } catch (e) { console.warn('Save failed', e); }
}

// For pagehide/unload, where async work may not finish.
export function saveLocalSync(game) {
  try { localStorage.setItem(SAVE_KEY, encodeSaveSync(game)); } catch (e) { console.warn('Save failed', e); }
}

export async function loadLocal() {
  let str = null;
  try { str = localStorage.getItem(SAVE_KEY); } catch { return null; }
  if (!str) return null;
  try {
    return await decodeSave(str);
  } catch (e) {
    console.warn('Local save unreadable, keeping a copy', e);
    try { localStorage.setItem(SAVE_KEY + '.broken', str); } catch { /* ignore */ }
    return null;
  }
}

export function clearLocal() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
