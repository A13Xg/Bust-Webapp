import { describe, it, expect } from 'vitest';
import { achievements, progressionCatalog, timeBucket, twoHoursRemainingMs, computeAchievementUnlocks, computeProgressionUnlocks, deriveProgressionSummary, deriveAllTimeRecords } from './rules.js';

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

  it('defines a staged achievement to badge to trophy catalog', () => {
    expect(progressionCatalog.length).toBeGreaterThanOrEqual(9);
    expect(achievements.length).toBeGreaterThanOrEqual(27);
    for (const track of progressionCatalog) {
      expect(track.stages.map(s => s.kind)).toEqual(['achievement', 'badge', 'trophy']);
      for (const badge of track.stages) expect(badge).toEqual(expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        desc: expect.any(String),
        tier: expect.stringMatching(/bronze|silver|gold|platinum|mythic/),
        kind: expect.stringMatching(/achievement|badge|trophy/),
        track: track.id,
        icon: expect.any(String),
        points: expect.any(Number),
        accent: expect.stringMatching(/^#/),
        goal: expect.any(Number),
      }));
    }
  });

  it('unlocks hot weather achievement, badge, and trophy thresholds', () => {
    const hotBusts = Array.from({ length: 10 }, (_, i) => ({
      user_id: 'u1',
      timestamp: new Date(2026, 6, i + 1, 13).toISOString(),
      temp_f: 101,
      pressure: 1005,
      note: 'heat test',
    }));

    const unlocks = computeProgressionUnlocks('u1', hotBusts, []);

    expect(unlocks).toEqual(expect.arrayContaining(['scorcher_achievement', 'scorcher_badge']));
    expect(unlocks).not.toContain('scorcher_trophy');
  });

  it('unlocks daypart badge after morning noon and night busts', () => {
    const busts = [
      { user_id: 'u1', timestamp: new Date(2026, 0, 1, 7).toISOString() },
      { user_id: 'u1', timestamp: new Date(2026, 0, 1, 13).toISOString() },
      { user_id: 'u1', timestamp: new Date(2026, 0, 1, 22).toISOString() },
    ];

    expect(computeProgressionUnlocks('u1', busts, [])).toEqual(expect.arrayContaining(['daypart_badge']));
  });

  it('derives progression summary with completion by track', () => {
    const unlocked = [{ user_id: 'u1', achievement_type: 'scorcher_achievement' }, { user_id: 'u1', achievement_type: 'daypart_badge' }];
    const summary = deriveProgressionSummary('u1', unlocked);

    expect(summary.totalUnlocked).toBe(3);
    expect(summary.totalItems).toBe(progressionCatalog.flatMap(t => t.stages).length);
    expect(summary.tracks.find(t => t.id === 'scorcher').unlocked).toBe(1);
    expect(summary.tracks.find(t => t.id === 'daypart').unlocked).toBe(2);
  });

  it('derives all-time records for analytics cards', () => {
    const busts = [
      { user_id: 'u1', username: 'Ada', timestamp: new Date(2026, 0, 1, 5, 30).toISOString(), temp_f: 35, pressure: 1010, note: 'cold field note' },
      { user_id: 'u2', username: 'Lin', timestamp: new Date(2026, 0, 1, 22, 30).toISOString(), temp_f: 91, pressure: 1030, note: 'hot high pressure note' },
      { user_id: 'u2', username: 'Lin', timestamp: new Date(2026, 0, 2, 22, 30).toISOString(), temp_f: 88, pressure: 1022, note: 'repeat' }
    ];

    const records = deriveAllTimeRecords(busts);

    expect(records.map(r => r.id)).toEqual(['volume_king', 'coldest_bust', 'pressure_peak', 'earliest_bust']);
    expect(records[0].value).toBe('Lin');
    expect(records[0].detail).toContain('2 total');
    expect(records[1].value).toBe('35°F');
    expect(records[2].value).toBe('1030 hPa');
    expect(records[3].detail).toContain('Ada');
  });
});
