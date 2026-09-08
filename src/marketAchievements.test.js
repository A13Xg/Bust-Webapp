/*
 * The Market category is the only part of the catalog that reads btc_usd, and
 * that column is nullable by design (a failed price lookup must never block a
 * bust). These tests pin two things: the checks work on priced history, and a
 * gap in pricing can never fabricate or destroy an unlock.
 */
import { describe, it, expect } from 'vitest';

import { achievements, computeAchievementUnlocks } from './rules.js';

const marketIds = achievements.filter(a => a.category === 'Market').map(a => a.id);
const USER = 'user-1';
const DAY = 86400000;
// Well clear of the two-hour cooldown, and always mid-afternoon on a weekday so
// unrelated time-of-day achievements do not drift into the assertions.
const base = Date.parse('2026-03-02T14:00:00Z');

function busts(prices, { start = base, stepDays = 1, extra = {} } = {}) {
  return prices.map((btc_usd, i) => ({
    id: `b-${i}`,
    user_id: USER,
    timestamp: new Date(start + i * stepDays * DAY).toISOString(),
    time_bucket: 'afternoon',
    note: '',
    btc_usd,
    ...extra,
  }));
}

/** Market-category ids unlocked for this history. */
function marketUnlocks(rows, existing = []) {
  const earned = computeAchievementUnlocks(USER, rows, existing, {
    createdAt: new Date(base - 400 * DAY).toISOString(),
    userCount: 4,
  });
  return earned.filter(id => marketIds.includes(id));
}

describe('market achievement catalog', () => {
  it('registers every Market item with a unique id, points and an icon', () => {
    expect(marketIds).toHaveLength(14);
    for (const item of achievements.filter(a => a.category === 'Market')) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.desc.length).toBeGreaterThan(0);
      expect(item.points).toBeGreaterThan(0);
      expect(item.micon).toBeTruthy();
      expect(['bronze', 'silver', 'gold', 'platinum', 'mythic']).toContain(item.tier);
      expect(['achievement', 'badge']).toContain(item.kind);
    }
  });
});

describe('price-threshold achievements', () => {
  it('unlocks the six-figure and capitulation marks at their thresholds', () => {
    expect(marketUnlocks(busts([120000]))).toContain('six_figure_summit');
    expect(marketUnlocks(busts([99999]))).not.toContain('six_figure_summit');
    expect(marketUnlocks(busts([25000]))).toContain('capitulation_witness');
    expect(marketUnlocks(busts([30000]))).not.toContain('capitulation_witness');
  });

  it('unlocks the round-number ritual only within $50 of a clean thousand', () => {
    expect(marketUnlocks(busts([70020]))).toContain('round_number_ritual');
    expect(marketUnlocks(busts([69985]))).toContain('round_number_ritual');
    expect(marketUnlocks(busts([70500]))).not.toContain('round_number_ritual');
  });

  it('counts priced busts for the stacker badge', () => {
    expect(marketUnlocks(busts(Array(9).fill(60000)))).not.toContain('sats_stacker');
    expect(marketUnlocks(busts(Array(10).fill(60000)))).toContain('sats_stacker');
  });
});

describe('sequence achievements', () => {
  it('needs four strictly monotonic priced busts in a row', () => {
    expect(marketUnlocks(busts([60000, 61000, 62000]))).not.toContain('number_go_up');
    expect(marketUnlocks(busts([60000, 61000, 62000, 63000]))).toContain('number_go_up');
    expect(marketUnlocks(busts([60000, 61000, 61000, 62000, 63000]))).not.toContain('number_go_up');
    expect(marketUnlocks(busts([63000, 62000, 61000, 60000]))).toContain('number_go_down');
  });

  it('unlocks whipsaw only on a move larger than 10 percent', () => {
    expect(marketUnlocks(busts([60000, 65000]))).not.toContain('whipsaw');
    expect(marketUnlocks(busts([60000, 67000]))).toContain('whipsaw');
    expect(marketUnlocks(busts([67000, 60000]))).toContain('whipsaw');
  });

  it('requires ten priced busts and a 2x span for diamond hands', () => {
    expect(marketUnlocks(busts([30000, 70000]))).not.toContain('diamond_hands');
    const wide = busts([30000, 35000, 40000, 45000, 50000, 55000, 58000, 59000, 59500, 61000]);
    expect(marketUnlocks(wide)).toContain('diamond_hands');
    const narrow = busts(Array.from({ length: 10 }, (_, i) => 60000 + i * 100));
    expect(marketUnlocks(narrow)).not.toContain('diamond_hands');
  });

  it('needs five prior priced busts before a new personal high or low counts', () => {
    expect(marketUnlocks(busts([50000, 51000, 52000, 53000, 54000]))).not.toContain('personal_ath');
    expect(marketUnlocks(busts([50000, 51000, 52000, 53000, 54000, 90000]))).toContain('personal_ath');
    expect(marketUnlocks(busts([50000, 51000, 52000, 53000, 54000, 10000]))).toContain('personal_atl');
  });
});

describe('calendar achievements', () => {
  const on = iso => [{ id: 'b-0', user_id: USER, timestamp: iso, time_bucket: 'afternoon', note: '', btc_usd: 60000 }];

  it('fires on the three Bitcoin holidays, using local calendar dates', () => {
    expect(marketUnlocks(on(new Date(2026, 0, 3, 14).toISOString()))).toContain('genesis_block_day');
    expect(marketUnlocks(on(new Date(2026, 4, 22, 14).toISOString()))).toContain('pizza_day');
    expect(marketUnlocks(on(new Date(2026, 9, 31, 14).toISOString()))).toContain('whitepaper_day');
    expect(marketUnlocks(on(new Date(2026, 0, 4, 14).toISOString()))).not.toContain('genesis_block_day');
  });
});

describe('missing prices', () => {
  it('never unlocks a price-dependent achievement from unpriced busts', () => {
    const unpriced = busts([null, null, null, null, null, null, null, null, null, null, null, null]);
    const earned = marketUnlocks(unpriced);
    for (const id of [
      'sats_stacker',
      'six_figure_summit',
      'number_go_up',
      'diamond_hands',
      'whipsaw',
      'personal_ath',
    ]) {
      expect(earned).not.toContain(id);
    }
  });

  it('ignores gaps rather than treating them as a price of zero', () => {
    // A null between two rises must not break the run, and must not read as a crash.
    expect(marketUnlocks(busts([60000, 61000, null, 62000, 63000]))).toContain('number_go_up');
    expect(marketUnlocks(busts([60000, null, 61000]))).not.toContain('whipsaw');
  });

  it('does not re-award something already unlocked', () => {
    const rows = busts([120000]);
    const existing = [{ id: 'a1', user_id: USER, achievement_type: 'six_figure_summit' }];
    expect(marketUnlocks(rows, existing)).not.toContain('six_figure_summit');
  });
});
