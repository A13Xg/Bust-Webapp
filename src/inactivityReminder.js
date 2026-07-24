const HOUR_MS = 60 * 60 * 1000;
export const FIRST_REMINDER_DELAY_MS = 52 * HOUR_MS;
export const REMINDER_WINDOW_MS = 24 * HOUR_MS;
export const MIN_REMINDER_INTERVAL_MS = 24 * HOUR_MS;

export const INACTIVITY_MESSAGE_CATALOG = [
  { text: 'Your cooldown ended hours ago. At this point, the inactivity appears deliberate.', weight: 5 },
  { text: 'Impressive discipline. In all the wrong places.', weight: 4 },
  { text: 'The BUST button misses you more than it should.', weight: 4 },
  { text: 'Still no bust. Bold strategy for a pressure logger.', weight: 4 },
  { text: 'Mission update: absolutely nothing has happened because of you.', weight: 4 },
  { text: 'You have achieved peak inactivity. Congratulations, I guess.', weight: 2 },
  { text: 'The crew is waiting. Your excuses are on schedule, at least.', weight: 2 },
  { text: 'Reminder: this app works better when you actually bust.', weight: 2 },
  { text: 'Your silence has been logged as tactical procrastination.', weight: 2 },
  { text: 'Your inactivity streak is becoming your strongest stat.', weight: 2 },
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
  return low + Math.round(random() * span);
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
      lastMessageIndex: Number.isInteger(parsed.lastMessageIndex) ? parsed.lastMessageIndex : null,
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
    lastMessageIndex: null,
  };

  if (state?.cycleBustAt === normalized.cycleBustAt) {
    normalized.scheduledFor = typeof state.scheduledFor === 'string' ? state.scheduledFor : null;
    normalized.lastSentAt = typeof state.lastSentAt === 'string' ? state.lastSentAt : null;
    normalized.lastMessageIndex = Number.isInteger(state.lastMessageIndex) ? state.lastMessageIndex : null;
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

function chooseWeightedMessageIndex(random = Math.random) {
  const totalWeight = INACTIVITY_MESSAGE_CATALOG.reduce((sum, entry) => sum + Math.max(1, Number(entry.weight) || 1), 0);
  let ticket = Math.floor(random() * totalWeight);
  for (let index = 0; index < INACTIVITY_MESSAGE_CATALOG.length; index += 1) {
    const entry = INACTIVITY_MESSAGE_CATALOG[index];
    ticket -= Math.max(1, Number(entry.weight) || 1);
    if (ticket < 0) return index;
  }
  return INACTIVITY_MESSAGE_CATALOG.length - 1;
}

export function pickInactivityReminderMessage({ random = Math.random, lastMessageIndex = null } = {}) {
  if (!INACTIVITY_MESSAGE_CATALOG.length) return { index: -1, text: 'Reminder: log a bust.' };
  let index = chooseWeightedMessageIndex(random);
  if (INACTIVITY_MESSAGE_CATALOG.length > 1 && Number.isInteger(lastMessageIndex) && index === lastMessageIndex) {
    index = (index + 1 + Math.floor(random() * (INACTIVITY_MESSAGE_CATALOG.length - 1))) % INACTIVITY_MESSAGE_CATALOG.length;
  }
  return { index, text: INACTIVITY_MESSAGE_CATALOG[index]?.text || 'Reminder: log a bust.' };
}

export function buildInactivityReminderMessage(random = Math.random, lastMessageIndex = null) {
  return pickInactivityReminderMessage({ random, lastMessageIndex }).text;
}

export function markInactivityReminderSent(state, { now = Date.now(), random = Math.random, messageIndex = null } = {}) {
  const cycleBustMs = toEpochMs(state?.cycleBustAt);
  if (cycleBustMs == null) return state || null;
  const [minMs, maxMs] = followupReminderWindow(now);
  return {
    cycleBustAt: isoAt(cycleBustMs),
    lastSentAt: isoAt(now),
    scheduledFor: scheduleInWindow(minMs, maxMs, random),
    lastMessageIndex: Number.isInteger(messageIndex) ? messageIndex : null,
  };
}
