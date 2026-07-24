const HOUR_MS = 60 * 60 * 1000;
export const FIRST_REMINDER_DELAY_MS = 52 * HOUR_MS;
export const REMINDER_WINDOW_MS = 24 * HOUR_MS;
export const MIN_REMINDER_INTERVAL_MS = 24 * HOUR_MS;

const MESSAGE_POOL = [
  'Your cooldown ended hours ago. At this point, the inactivity appears deliberate.',
  'Your cooldown ended hours ago. At this point, the inactivity appears deliberate.',
  'Impressive discipline. In all the wrong places.',
  'Impressive discipline. In all the wrong places.',
  'The BUST button misses you more than it should.',
  'The BUST button misses you more than it should.',
  'Still no bust. Bold strategy for a pressure logger.',
  'Still no bust. Bold strategy for a pressure logger.',
  'Mission update: absolutely nothing has happened because of you.',
  'Mission update: absolutely nothing has happened because of you.',
  'You have achieved peak inactivity. Congratulations, I guess.',
  'The crew is waiting. Your excuses are on schedule, at least.',
  'Reminder: this app works better when you actually bust.',
  'Your silence has been logged as tactical procrastination.',
  'Your inactivity streak is becoming your strongest stat.',
];

function toEpochMs(value) {
  if (value == null || value === '') return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function isoAt(ms) {
  return new Date(ms).toISOString();
}

function randomBetween(min, max, random = Math.random) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const span = high - low;
  if (span <= 0) return low;
  return low + Math.floor(random() * (span + 1));
}

export function inactivityReminderStorageKey(userId) {
  return `bust_inactivity_reminder:${userId}`;
}

export function loadInactivityReminderState(storage = globalThis.localStorage, userId) {
  if (!userId) return null;
  try {
    const raw = storage?.getItem?.(inactivityReminderStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      cycleBustAt: typeof parsed.cycleBustAt === 'string' ? parsed.cycleBustAt : null,
      scheduledFor: typeof parsed.scheduledFor === 'string' ? parsed.scheduledFor : null,
      lastSentAt: typeof parsed.lastSentAt === 'string' ? parsed.lastSentAt : null,
    };
  } catch {
    return null;
  }
}

export function saveInactivityReminderState(storage = globalThis.localStorage, userId, state) {
  if (!userId) return;
  try {
    const key = inactivityReminderStorageKey(userId);
    if (!state || !state.cycleBustAt) {
      storage?.removeItem?.(key);
      return;
    }
    storage?.setItem?.(key, JSON.stringify(state));
  } catch {
    // ignore storage quota/private-mode errors
  }
}

function firstReminderWindow(cycleBustMs) {
  const start = cycleBustMs + FIRST_REMINDER_DELAY_MS;
  return [start, start + REMINDER_WINDOW_MS];
}

function followupReminderWindow(lastSentMs) {
  const start = lastSentMs + MIN_REMINDER_INTERVAL_MS;
  return [start, start + REMINDER_WINDOW_MS];
}

function scheduleInWindow(windowStart, windowEnd, random) {
  return isoAt(randomBetween(windowStart, windowEnd, random));
}

export function reconcileInactivityReminderState({ state, latestBustAt, now = Date.now(), random = Math.random }) {
  const cycleBustMs = toEpochMs(latestBustAt);
  if (cycleBustMs == null) return null;

  const normalized = {
    cycleBustAt: isoAt(cycleBustMs),
    scheduledFor: null,
    lastSentAt: null,
  };

  if (state?.cycleBustAt === normalized.cycleBustAt) {
    normalized.scheduledFor = typeof state.scheduledFor === 'string' ? state.scheduledFor : null;
    normalized.lastSentAt = typeof state.lastSentAt === 'string' ? state.lastSentAt : null;
  }

  const lastSentMs = toEpochMs(normalized.lastSentAt);
  let minMs;
  let maxMs;
  if (lastSentMs != null && lastSentMs >= cycleBustMs) {
    [minMs, maxMs] = followupReminderWindow(lastSentMs);
  } else {
    [minMs, maxMs] = firstReminderWindow(cycleBustMs);
  }

  const scheduledMs = toEpochMs(normalized.scheduledFor);
  if (scheduledMs == null || scheduledMs < minMs || scheduledMs > maxMs) {
    const start = Math.max(minMs, now);
    const end = Math.max(maxMs, start);
    normalized.scheduledFor = scheduleInWindow(start, end, random);
  }

  return normalized;
}

export function isInactivityReminderDue(state, latestBustAt, now = Date.now()) {
  const cycleBustMs = toEpochMs(latestBustAt);
  if (cycleBustMs == null || !state) return false;
  const stateCycleMs = toEpochMs(state.cycleBustAt);
  if (stateCycleMs == null || stateCycleMs !== cycleBustMs) return false;
  const scheduledMs = toEpochMs(state.scheduledFor);
  if (scheduledMs == null || now < scheduledMs) return false;
  const lastSentMs = toEpochMs(state.lastSentAt);
  if (lastSentMs != null && now - lastSentMs < MIN_REMINDER_INTERVAL_MS) return false;
  return true;
}

export function nextInactivityReminderDelayMs(state, now = Date.now()) {
  const scheduledMs = toEpochMs(state?.scheduledFor);
  if (scheduledMs == null) return 60_000;
  if (scheduledMs <= now) return 1_000;
  return Math.max(1_000, Math.min(60_000, scheduledMs - now));
}

export function buildInactivityReminderMessage(random = Math.random) {
  const idx = Math.floor(random() * MESSAGE_POOL.length);
  return MESSAGE_POOL[Math.max(0, Math.min(MESSAGE_POOL.length - 1, idx))];
}

export function markInactivityReminderSent(state, { now = Date.now(), random = Math.random } = {}) {
  const cycleBustMs = toEpochMs(state?.cycleBustAt);
  if (cycleBustMs == null) return state || null;
  const [minMs, maxMs] = followupReminderWindow(now);
  return {
    cycleBustAt: isoAt(cycleBustMs),
    lastSentAt: isoAt(now),
    scheduledFor: scheduleInWindow(minMs, maxMs, random),
  };
}
