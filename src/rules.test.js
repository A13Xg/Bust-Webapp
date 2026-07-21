import { describe, it, expect } from 'vitest';
import { achievements, capUnlocksPerBust, progressionCatalog, timeBucket, twoHoursRemainingMs, computeAchievementUnlocks, computeProgressionUnlocks, deriveProgressionSummary, deriveAllTimeRecords, deriveStreaks, levelForXp, derivePersonalStats, buildTrend, todayKey } from './rules.js';

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

    expect(records.map(r => r.id)).toEqual(['volume_king', 'coldest_bust', 'pressure_peak', 'earliest_bust', 'hottest_bust', 'streak_king', 'night_owl', 'wordsmith']);
    expect(records[0].value).toBe('Lin');
    expect(records[0].detail).toContain('2 total');
    expect(records[1].value).toBe('35°F');
    expect(records[2].value).toBe('1030 hPa');
    expect(records[3].detail).toContain('Ada');
    expect(records[4].value).toBe('91°F');
    expect(records[5].value).toBe('2d');
    expect(records[5].detail).toContain('Lin');
  });

  it('derives daily streaks from consecutive local days', () => {
    const now = new Date();
    const day = (offset, hour = 12) => { const d = new Date(now); d.setDate(d.getDate() - offset); d.setHours(hour); return { timestamp: d.toISOString() }; };
    expect(deriveStreaks([])).toEqual({ current: 0, longest: 0 });
    expect(deriveStreaks([day(0), day(1), day(2)])).toEqual({ current: 3, longest: 3 });
    expect(deriveStreaks([day(0), day(2), day(3)]).current).toBe(1);
    expect(deriveStreaks([day(5), day(6), day(7)]).current).toBe(0);
    expect(deriveStreaks([day(5), day(6), day(7)]).longest).toBe(3);
  });

  it('maps XP totals to satirical levels with progress', () => {
    expect(levelForXp(0)).toMatchObject({ level: 1, title: 'Little Swimmer' });
    expect(levelForXp(60)).toMatchObject({ level: 2, title: 'Puddle Scout' });
    expect(levelForXp(200)).toMatchObject({ level: 3, title: 'Bust Buddy' });
    expect(levelForXp(99999)).toMatchObject({ level: 10, title: 'MasterBaiter', pct: 100, nextAt: null, nextTitle: null });
    expect(levelForXp(75).pct).toBeGreaterThan(0);
  });

  it('derives personal profile stats', () => {
    const busts = [
      { user_id: 'u1', timestamp: new Date(2026, 0, 1, 6).toISOString(), temp_f: 40, note: 'yes', time_bucket: 'Early Morning' },
      { user_id: 'u1', timestamp: new Date(2026, 0, 1, 22).toISOString(), temp_f: 60, note: '', time_bucket: 'Prime Night' },
      { user_id: 'u1', timestamp: new Date(2026, 0, 2, 22).toISOString(), temp_f: 80, note: 'longer', time_bucket: 'Prime Night' },
      { user_id: 'u2', timestamp: new Date(2026, 0, 2, 10).toISOString(), temp_f: 200 }
    ];
    const stats = derivePersonalStats('u1', busts, [{ user_id: 'u1', achievement_type: 'first_release' }]);
    expect(stats.total).toBe(3);
    expect(stats.favoriteBucket).toBe('Prime Night');
    expect(stats.avgTemp).toBe(60);
    expect(stats.notes).toBe(2);
    expect(stats.level.points).toBe(10);
    expect(stats.streaks.longest).toBe(2);
  });

  it('builds a fixed-length daily trend series', () => {
    const now = new Date(2026, 5, 30, 12);
    const busts = [{ timestamp: new Date(2026, 5, 30, 8).toISOString() }, { timestamp: new Date(2026, 5, 29, 8).toISOString() }, { timestamp: new Date(2026, 5, 29, 9).toISOString() }];
    const trend = buildTrend(busts, 7, now);
    expect(trend).toHaveLength(7);
    expect(trend[6].count).toBe(1);
    expect(trend[5].count).toBe(2);
    expect(trend[0].count).toBe(0);
  });

  it('registers expansion items with unique ids', async () => {
    const { expansionItems } = await import('./expansion.js');
    expect(expansionItems.length).toBeGreaterThanOrEqual(50);
    const ids = achievements.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const it of expansionItems) expect(it).toEqual(expect.objectContaining({ micon: expect.any(String), tier: expect.any(String), kind: expect.stringMatching(/achievement|badge/), category: expect.any(String), points: expect.any(Number) }));
  });

  it('unlocks expansion timing, environment, and note achievements', () => {
    const busts = [
      { id: 'b1', user_id: 'u1', timestamp: new Date(2026, 4, 3, 0, 2).toISOString(), pressure: 985, note: 'x'.repeat(240) },
      { id: 'b2', user_id: 'u1', timestamp: new Date(2026, 4, 4, 9, 0).toISOString(), pressure: 1000, note: 'thou art busted' }
    ];
    const ids = computeAchievementUnlocks('u1', busts, []);
    expect(ids).toEqual(expect.arrayContaining(['midnight_strike', 'on_the_dot', 'storm_chaser', 'novelist', 'shakespeare']));
    expect(ids).not.toContain('minute_hand');
  });

  it('unlocks elevation achievements and badges from altitude tracking', () => {
    const highBusts = Array.from({ length: 5 }, (_, i) => ({
      id: `high-${i}`,
      user_id: 'u1',
      timestamp: new Date(2026, 4, i + 1, 9, 0).toISOString(),
      elevation_ft: 5600
    }));
    const variedBusts = [
      { id: 'low', user_id: 'u1', timestamp: new Date(2026, 5, 1, 8).toISOString(), elevation_ft: 42 },
      { id: 'mid', user_id: 'u1', timestamp: new Date(2026, 5, 2, 8).toISOString(), elevation_ft: 1500 },
      { id: 'alpine', user_id: 'u1', timestamp: new Date(2026, 5, 3, 8).toISOString(), elevation_ft: 8500 }
    ];

    expect(computeAchievementUnlocks('u1', highBusts, [])).toEqual(expect.arrayContaining(['thin_air', 'mile_high_club']));
    expect(computeAchievementUnlocks('u1', variedBusts, [])).toEqual(expect.arrayContaining(['sea_level_scout', 'altitude_sampler']));
  });

  it('unlocks squad-play achievements from the group feed', () => {
    const t = new Date(2026, 4, 5, 18, 0, 0);
    const busts = [
      { id: 'a', user_id: 'u2', timestamp: new Date(t.getTime() - 30000).toISOString() },
      { id: 'b', user_id: 'u1', timestamp: t.toISOString() }
    ];
    const ids = computeAchievementUnlocks('u1', busts, [], { userCount: 3 });
    expect(ids).toEqual(expect.arrayContaining(['first_responder', 'synchronized_swimmers']));
  });

  it('caps unlocks to one achievement and one badge per bust, keeping the highest XP', () => {
    // first bust with rich conditions qualifies for many at once
    const bust = { id: 'b1', user_id: 'u1', timestamp: new Date(2026, 0, 1, 6).toISOString(), temp_f: 91, pressure: 1025, note: 'a very detailed field report from the bay', lat: 1, long: 2 };
    const raw = computeAchievementUnlocks('u1', [bust], []);
    expect(raw.length).toBeGreaterThan(2);
    const capped = capUnlocksPerBust(raw);
    expect(capped.length).toBeLessThanOrEqual(2);
    const kinds = capped.map(id => achievements.find(a => a.id === id).kind);
    expect(kinds.filter(k => k === 'achievement').length).toBeLessThanOrEqual(1);
    expect(kinds.filter(k => k !== 'achievement').length).toBeLessThanOrEqual(1);
    // highest-XP achievement among qualifiers wins
    const achIds = raw.filter(id => achievements.find(a => a.id === id)?.kind === 'achievement');
    const top = achIds.sort((a, b) => (achievements.find(x => x.id === b).points) - (achievements.find(x => x.id === a).points))[0];
    expect(capped).toContain(top);
    expect(capUnlocksPerBust([])).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Historical / reconciliation correctness
  // ──────────────────────────────────────────────────────────────────────────
  describe('historical achievement reconciliation', () => {
    function makeBust(userId, overrides = {}) {
      return { user_id: userId, timestamp: new Date().toISOString(), ...overrides };
    }

    it('unlocks early_bird from a historical bust, not just the latest', () => {
      const busts = [
        makeBust('u1', { timestamp: new Date(2026, 0, 1, 6).toISOString() }), // early morning
        makeBust('u1', { timestamp: new Date(2026, 0, 2, 22).toISOString() }) // prime night (latest)
      ];
      const unlocks = computeAchievementUnlocks('u1', busts, []);
      expect(unlocks).toContain('early_bird');
    });

    it('unlocks night_ops from a historical bust, not just the latest', () => {
      const busts = [
        makeBust('u1', { timestamp: new Date(2026, 0, 1, 2).toISOString() }), // late night
        makeBust('u1', { timestamp: new Date(2026, 0, 2, 14).toISOString() }) // afternoon (latest)
      ];
      const unlocks = computeAchievementUnlocks('u1', busts, []);
      expect(unlocks).toContain('night_ops');
    });

    it('unlocks heat_seeker from a historical hot bust', () => {
      const busts = [
        makeBust('u1', { timestamp: new Date(2026, 6, 1, 13).toISOString(), temp_f: 91 }),
        makeBust('u1', { timestamp: new Date(2026, 6, 2, 13).toISOString(), temp_f: 70 }) // latest is cool
      ];
      const unlocks = computeAchievementUnlocks('u1', busts, []);
      expect(unlocks).toContain('heat_seeker');
    });

    it('unlocks cold_front from a historical cold bust', () => {
      const busts = [
        makeBust('u1', { timestamp: new Date(2026, 0, 1, 9).toISOString(), temp_f: 40 }),
        makeBust('u1', { timestamp: new Date(2026, 6, 1, 13).toISOString(), temp_f: 80 }) // latest is warm
      ];
      const unlocks = computeAchievementUnlocks('u1', busts, []);
      expect(unlocks).toContain('cold_front');
    });

    it('unlocks double_shift when 2 busts occurred on a non-latest day', () => {
      const busts = [
        // Two busts on Jan 1
        makeBust('u1', { timestamp: new Date(2026, 0, 1, 10).toISOString() }),
        makeBust('u1', { timestamp: new Date(2026, 0, 1, 14).toISOString() }),
        // One bust on Jan 2 (latest)
        makeBust('u1', { timestamp: new Date(2026, 0, 2, 12).toISOString() })
      ];
      const unlocks = computeAchievementUnlocks('u1', busts, []);
      expect(unlocks).toContain('double_shift');
    });

    it('unlocks week_warrior from any rolling 7-day window', () => {
      // 5 busts on consecutive days, none near "now"
      const base = new Date('2026-01-01T12:00:00Z').getTime();
      const busts = Array.from({ length: 5 }, (_, i) =>
        makeBust('u1', { timestamp: new Date(base + i * 86400000).toISOString() })
      );
      const unlocks = computeAchievementUnlocks('u1', busts, []);
      expect(unlocks).toContain('week_warrior');
    });

    it('does not re-unlock already persisted achievements', () => {
      const busts = [makeBust('u1', { timestamp: new Date(2026, 0, 1, 6).toISOString() })];
      const existing = [{ user_id: 'u1', achievement_type: 'first_release' }];
      const unlocks = computeAchievementUnlocks('u1', busts, existing);
      expect(unlocks).not.toContain('first_release');
    });

    it('is idempotent: reconciling twice yields no new unlocks', () => {
      const busts = Array.from({ length: 5 }, (_, i) =>
        makeBust('u1', {
          timestamp: new Date(2026, 6, i + 1, 13).toISOString(),
          temp_f: 101,
          pressure: 1025,
          note: 'heat test repeated note here',
          lat: 1, long: 2
        })
      );
      const pass1 = computeAchievementUnlocks('u1', busts, []);
      const existing = pass1.map(id => ({ user_id: 'u1', achievement_type: id }));
      const pass2 = computeAchievementUnlocks('u1', busts, existing);
      expect(pass2).toHaveLength(0);
    });

    it('handles empty bust history gracefully', () => {
      expect(computeAchievementUnlocks('u1', [], [])).toEqual([]);
      expect(computeProgressionUnlocks('u1', [], [])).toEqual([]);
    });

    it('does not unlock achievements for other users busts', () => {
      const busts = [makeBust('u2', { timestamp: new Date(2026, 0, 1, 6).toISOString() })];
      const unlocks = computeAchievementUnlocks('u1', busts, []);
      expect(unlocks).toHaveLength(0);
    });

    it('can unlock multiple achievements from a single bust', () => {
      const bust = makeBust('u1', {
        timestamp: new Date(2026, 0, 1, 6).toISOString(),
        temp_f: 91,
        pressure: 1025,
        note: 'this is a field note that is at least thirty characters long',
        lat: 1, long: 2
      });
      const unlocks = computeAchievementUnlocks('u1', [bust], []);
      // Should contain at least first_release, early_bird, heat_seeker, high_pressure, field_reporter, cartographer
      expect(unlocks.length).toBeGreaterThan(3);
      expect(unlocks).toContain('first_release');
      expect(unlocks).toContain('early_bird');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Presentation cap must not affect what was computed
  // ──────────────────────────────────────────────────────────────────────────
  it('capUnlocksPerBust limits display but the full computed set is larger', () => {
    const bust = {
      user_id: 'u1',
      timestamp: new Date(2026, 0, 1, 6).toISOString(),
      temp_f: 91, pressure: 1025,
      note: 'this is a very detailed long note that is at least thirty chars',
      lat: 1, long: 2
    };
    const allNew = computeAchievementUnlocks('u1', [bust], []);
    const capped = capUnlocksPerBust(allNew);
    // Many earned, but cap limits to at most 1 achievement + 1 badge/trophy
    expect(allNew.length).toBeGreaterThan(capped.length);
    expect(capped.length).toBeLessThanOrEqual(2);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Streak progressFor fix
  // ──────────────────────────────────────────────────────────────────────────
  describe('streak progression track', () => {
    it('unlocks double_shift from busts on different local days', () => {
      // Two busts on day 1, one on day 2 (tests that non-latest day is checked)
      const busts = [
        { user_id: 'u1', timestamp: new Date(2026, 0, 1, 10).toISOString() },
        { user_id: 'u1', timestamp: new Date(2026, 0, 1, 15).toISOString() },
        { user_id: 'u1', timestamp: new Date(2026, 0, 3, 12).toISOString() }
      ];
      const unlocks = computeProgressionUnlocks('u1', busts, []);
      expect(unlocks).toContain('streak_achievement');
    });

    it('unlocks week_warrior from 5 busts in any 7-day window', () => {
      const base = new Date('2026-03-01T12:00:00Z').getTime();
      const busts = Array.from({ length: 5 }, (_, i) =>
        ({ user_id: 'u1', timestamp: new Date(base + i * 86400000).toISOString() })
      );
      const unlocks = computeProgressionUnlocks('u1', busts, []);
      expect(unlocks).toContain('streak_badge');
    });

    it('does not unlock week_warrior from 5 busts spread across 8 days', () => {
      const base = new Date('2026-03-01T12:00:00Z').getTime();
      const busts = Array.from({ length: 5 }, (_, i) =>
        ({ user_id: 'u1', timestamp: new Date(base + i * 2 * 86400000).toISOString() })
      );
      // 5 busts but spread over 8 days, no 7-day window has 5
      const unlocks = computeProgressionUnlocks('u1', busts, []);
      expect(unlocks).not.toContain('streak_badge');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Legacy double_shift description parity
  // ──────────────────────────────────────────────────────────────────────────
  it('unlocks legacy double_shift only when 2 busts share a local day', () => {
    // Same local day: qualifies
    const sameDayBusts = [
      { user_id: 'u1', timestamp: new Date(2026, 0, 1, 9).toISOString() },
      { user_id: 'u1', timestamp: new Date(2026, 0, 1, 18).toISOString() }
    ];
    expect(computeAchievementUnlocks('u1', sameDayBusts, [])).toContain('double_shift');

    // Different days: does not qualify
    const diffDayBusts = [
      { user_id: 'u1', timestamp: new Date(2026, 0, 1, 9).toISOString() },
      { user_id: 'u1', timestamp: new Date(2026, 0, 2, 9).toISOString() }
    ];
    expect(computeAchievementUnlocks('u1', diffDayBusts, [])).not.toContain('double_shift');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // todayKey consistency
  // ──────────────────────────────────────────────────────────────────────────
  it('todayKey returns the same value for same local day regardless of time', () => {
    const d1 = new Date(2026, 5, 15, 0, 0, 0);
    const d2 = new Date(2026, 5, 15, 23, 59, 59);
    expect(todayKey(d1)).toBe(todayKey(d2));
    expect(todayKey(d1)).toBe('2026-6-15');
  });
});
