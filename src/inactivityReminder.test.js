import { describe, expect, it, vi } from 'vitest';

import {
  FIRST_REMINDER_DELAY_MS,
  MIN_REMINDER_INTERVAL_MS,
  REMINDER_WINDOW_MS,
  INACTIVITY_MESSAGE_CATALOG,
  inactivityReminderStorageKey,
  isInactivityReminderDue,
  loadInactivityReminderState,
  markInactivityReminderSent,
  nextInactivityReminderDelayMs,
  pickInactivityReminderMessage,
  reconcileInactivityReminderState,
  saveInactivityReminderState,
} from './inactivityReminder.js';

function iso(ms) {
  return new Date(ms).toISOString();
}

describe('inactivity reminder scheduling', () => {
  it('schedules first reminder once per bust cycle and keeps persisted timestamp', () => {
    const bustMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const now = bustMs + 53 * 60 * 60 * 1000;
    const first = reconcileInactivityReminderState({ latestBustAt: iso(bustMs), state: null, now, random: () => 0.5 });
    expect(first?.cycleBustAt).toBe(iso(bustMs));
    const firstScheduledMs = new Date(first.scheduledFor).getTime();
    expect(firstScheduledMs).toBeGreaterThanOrEqual(bustMs + FIRST_REMINDER_DELAY_MS);
    expect(firstScheduledMs).toBeLessThanOrEqual(bustMs + FIRST_REMINDER_DELAY_MS + REMINDER_WINDOW_MS);

    const second = reconcileInactivityReminderState({
      latestBustAt: iso(bustMs),
      state: first,
      now: now + 10_000,
      random: () => 0,
    });
    expect(second?.scheduledFor).toBe(first?.scheduledFor);
  });

  it('resets reminder cycle when a new bust timestamp appears', () => {
    const firstBustMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const secondBustMs = firstBustMs + 80 * 60 * 60 * 1000;
    const stale = {
      cycleBustAt: iso(firstBustMs),
      lastSentAt: iso(firstBustMs + 60 * 60 * 1000),
      scheduledFor: iso(firstBustMs + 70 * 60 * 60 * 1000),
      lastMessageIndex: 2,
    };

    const reconciled = reconcileInactivityReminderState({
      latestBustAt: iso(secondBustMs),
      state: stale,
      now: secondBustMs,
      random: () => 0,
    });

    expect(reconciled).toEqual({
      cycleBustAt: iso(secondBustMs),
      lastSentAt: null,
      scheduledFor: iso(secondBustMs + FIRST_REMINDER_DELAY_MS),
      lastMessageIndex: null,
    });
  });

  it('enforces one reminder per rolling 24 hours and schedules the next randomized window', () => {
    const bustMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const dueAt = bustMs + FIRST_REMINDER_DELAY_MS;
    const state = {
      cycleBustAt: iso(bustMs),
      lastSentAt: null,
      scheduledFor: iso(dueAt),
    };

    expect(isInactivityReminderDue(state, iso(bustMs), dueAt)).toBe(true);
    const sent = markInactivityReminderSent(state, { now: dueAt, random: () => 0.25 });
    expect(isInactivityReminderDue(sent, iso(bustMs), dueAt + MIN_REMINDER_INTERVAL_MS - 1)).toBe(false);
    const nextMs = new Date(sent.scheduledFor).getTime();
    expect(nextMs).toBeGreaterThanOrEqual(dueAt + MIN_REMINDER_INTERVAL_MS);
    expect(nextMs).toBeLessThanOrEqual(dueAt + MIN_REMINDER_INTERVAL_MS + REMINDER_WINDOW_MS);
  });

  it('returns no schedule when there is no successful bust yet', () => {
    expect(reconcileInactivityReminderState({ latestBustAt: null, state: null })).toBeNull();
  });
});

describe('inactivity reminder storage', () => {
  it('loads and saves per-user reminder state', () => {
    const storage = {
      values: new Map(),
      getItem: vi.fn(key => storage.values.get(key) ?? null),
      setItem: vi.fn((key, value) => storage.values.set(key, value)),
      removeItem: vi.fn(key => storage.values.delete(key)),
    };
    const state = {
      cycleBustAt: iso(Date.UTC(2026, 0, 1, 0, 0, 0)),
      lastSentAt: null,
      scheduledFor: iso(Date.UTC(2026, 0, 3, 4, 0, 0)),
      lastMessageIndex: 2,
    };

    saveInactivityReminderState(storage, 'user-1', state);
    expect(storage.setItem).toHaveBeenCalledWith(inactivityReminderStorageKey('user-1'), JSON.stringify(state));
    expect(loadInactivityReminderState(storage, 'user-1')).toEqual(state);

    saveInactivityReminderState(storage, 'user-1', null);
    expect(storage.removeItem).toHaveBeenCalledWith(inactivityReminderStorageKey('user-1'));
  });

  it('uses short polling delay for due reminders and minute cadence otherwise', () => {
    expect(nextInactivityReminderDelayMs({ scheduledFor: iso(Date.now() - 1_000) }, Date.now())).toBe(1_000);
    expect(nextInactivityReminderDelayMs({ scheduledFor: iso(Date.now() + 10 * 60 * 1000) }, Date.now())).toBe(60_000);
  });

  it('avoids immediately repeating the previous reminder message', () => {
    const previousIndex = INACTIVITY_MESSAGE_CATALOG.findIndex(item =>
      item.text.includes('cooldown ended hours ago')
    );
    const selected = pickInactivityReminderMessage({ random: () => 0, lastMessageIndex: previousIndex });
    expect(selected.index).not.toBe(previousIndex);
    expect(typeof selected.text).toBe('string');
    expect(selected.text.length).toBeGreaterThan(0);
  });
});
