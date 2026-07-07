/* Tiny SFX manager for BUST. HTMLAudio-based, resilient to missing files & autoplay policy. */
const BASE = import.meta.env.BASE_URL || '/';
const FILES = {
  charge: BASE + 'sfx/charge-loop.mp3',
  explosion: BASE + 'sfx/explosion-splash.mp3',
  badge: BASE + 'sfx/badge-unlock.mp3',
  drip: BASE + 'sfx/drip-ambient.mp3'
};

let muted = localStorage.getItem('bust_muted') === '1';
const listeners = new Set();
const cache = {};
const live = new Set();

function el(name) {
  if (!cache[name]) {
    const a = new Audio(FILES[name]);
    a.preload = 'auto';
    cache[name] = a;
  }
  return cache[name];
}

export function isMuted() { return muted; }
export function toggleMuted() {
  muted = !muted;
  localStorage.setItem('bust_muted', muted ? '1' : '0');
  if (muted) stopAll();
  listeners.forEach(fn => fn(muted));
  return muted;
}
export function onMuteChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Play a sound. Returns a handle with stop(). Safe no-op when muted or file missing. */
export function play(name, { loop = false, volume = 1 } = {}) {
  const noop = { stop: () => {} };
  if (muted || !FILES[name]) return noop;
  try {
    // Clone for overlapping one-shots; reuse the cached element for loops.
    const a = loop ? el(name) : el(name).cloneNode();
    a.loop = loop;
    a.volume = volume;
    a.currentTime = 0;
    const p = a.play();
    if (p?.catch) p.catch(() => {}); // autoplay policy — ignore
    live.add(a);
    a.addEventListener('ended', () => live.delete(a), { once: true });
    return { stop: () => { try { a.pause(); a.currentTime = 0; } catch {} live.delete(a); } };
  } catch { return noop; }
}

export function stopAll() {
  for (const a of [...live]) { try { a.pause(); a.currentTime = 0; } catch {} }
  live.clear();
}
