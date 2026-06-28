import { describe, it, expect } from 'vitest';
import { timeBucket, twoHoursRemainingMs, computeAchievementUnlocks } from './rules.js';

describe('BUST rules', () => {
  it('labels time-of-day buckets', () => {
    expect(timeBucket(new Date('2026-01-01T02:00:00'))).toBe('Late Night');
    expect(timeBucket(new Date('2026-01-01T06:00:00'))).toBe('Early Morning');
    expect(timeBucket(new Date('2026-01-01T22:00:00'))).toBe('Prime Night');
  });

  it('enforces a silent two-hour cooldown from last timestamp', () => {
    const now = new Date('2026-01-01T12:00:00Z').getTime();
    expect(twoHoursRemainingMs('2026-01-01T11:00:00Z', now)).toBe(60 * 60 * 1000);
    expect(twoHoursRemainingMs('2026-01-01T09:30:00Z', now)).toBe(0);
  });

  it('unlocks first bust, environmental, note, and coordinate achievements', () => {
    const bust = { user_id: 'u1', timestamp: new Date(2026, 0, 1, 6).toISOString(), temp_f: 91, pressure: 1025, note: 'a very detailed field report from the bay', lat: 1, long: 2 };
    expect(computeAchievementUnlocks('u1', [bust], [])).toEqual(expect.arrayContaining(['first_release','early_bird','heat_seeker','high_pressure','field_reporter','cartographer']));
  });
});
