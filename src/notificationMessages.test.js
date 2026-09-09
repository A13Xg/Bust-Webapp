import { describe, it, expect } from 'vitest';

import {
  ACHIEVEMENT_BODIES,
  ACHIEVEMENT_TITLES,
  BUST_BODIES,
  BUST_TITLES,
  INACTIVITY_MESSAGE_CATALOG,
  buildAchievementNotification,
  buildBustNotification,
  seedIndex,
} from './notificationMessages.js';

describe('notification copy', () => {
  it('keeps every catalog non-empty so a notification can never ship blank', () => {
    for (const catalog of [BUST_TITLES, BUST_BODIES, ACHIEVEMENT_TITLES, ACHIEVEMENT_BODIES]) {
      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.every(entry => entry.trim().length > 0)).toBe(true);
    }
    expect(INACTIVITY_MESSAGE_CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(INACTIVITY_MESSAGE_CATALOG.every(entry => entry.text.trim().length > 0)).toBe(true);
  });

  it('keeps inactivity reminder entries shaped for weighted selection', () => {
    for (const entry of INACTIVITY_MESSAGE_CATALOG) {
      expect(typeof entry.text).toBe('string');
      expect(entry.text.trim()).not.toBe('');
      expect(Number.isFinite(entry.weight)).toBe(true);
      expect(entry.weight).toBeGreaterThan(0);
    }
  });

  it('picks a variant deterministically so two devices never disagree', () => {
    const a = buildBustNotification({ username: 'Rex', bustId: 'b-1' });
    const b = buildBustNotification({ username: 'Rex', bustId: 'b-1' });
    expect(a).toEqual(b);
    expect(seedIndex('b-1', 5)).toBe(seedIndex('b-1', 5));
  });

  it('spreads variants across different events', () => {
    const titles = new Set(
      Array.from({ length: 40 }, (_, i) => buildBustNotification({ username: 'Rex', bustId: `b-${i}` }).title)
    );
    expect(titles.size).toBeGreaterThan(1);
  });

  it('quotes the note when there is one and stays inside the tag namespace', () => {
    const withNote = buildBustNotification({ username: 'Rex', note: 'shed a tear', bustId: 'b-9', city: 'Dayton' });
    expect(withNote.title).toContain('Rex');
    expect(withNote.body).toContain('shed a tear');
    expect(withNote.body).toContain('Dayton');
    expect(withNote.tag).toBe('bust-b-9');
    expect(withNote.kind).toBe('bust');

    const withoutNote = buildBustNotification({ username: 'Rex', bustId: 'b-9' });
    expect(BUST_BODIES).toContain(withoutNote.body);
  });

  it('falls back to a usable name when the username is missing', () => {
    const notification = buildBustNotification({ bustId: 'b-2' });
    expect(notification.title).toContain('Someone');
  });

  it('names the achievement in the title', () => {
    const notification = buildAchievementNotification({
      username: 'Rex',
      achievementName: 'Night Ops',
      achievementId: 'night_ops',
      tier: 'silver',
    });
    expect(notification.title).toContain('Night Ops');
    expect(notification.title).toContain('Rex');
    expect(ACHIEVEMENT_BODIES).toContain(notification.body);
    expect(notification.tier).toBe('silver');
  });

  it('keeps seedIndex inside bounds for any input', () => {
    for (const seed of ['', 'x', 'a-very-long-seed-value', '☃', '12345']) {
      const index = seedIndex(seed, 7);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(7);
    }
    expect(seedIndex('anything', 0)).toBe(0);
  });
});
