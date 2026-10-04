import { describe, expect, it } from 'vitest';
import { comparisonRows, earnedRecords, userMetrics, mergeReconciledAwards } from './socialData.js';

const award = (id, user_id, achievement_type, unlocked_at) => ({ id, user_id, achievement_type, unlocked_at });

describe('persisted social data', () => {
  it('deduplicates all award kinds, includes unknown history, and orders recorded times', () => {
    const rows = [
      award('1', 'a', 'first_release', '2025-01-01T00:00:00Z'),
      award('2', 'a', 'first_release', '2025-01-02T00:00:00Z'),
      award('3', 'a', 'hat_trick', '2025-01-03T00:00:00Z'),
      award('4', 'a', 'retired_award', 'invalid'),
    ];
    expect(earnedRecords(rows, 'a').map(row => row.achievement_type)).toEqual([
      'hat_trick',
      'first_release',
      'retired_award',
    ]);
    expect(earnedRecords(rows, 'a')[2].item.points).toBeNull();
  });

  it('compares only the union of earned awards', () => {
    const rows = [award('1', 'a', 'first_release', '2025-01-01'), award('2', 'b', 'hat_trick', '2025-01-02')];
    expect(
      comparisonRows(rows, 'a', 'b').map(({ id, viewerEarned, subjectEarned }) => [id, viewerEarned, subjectEarned])
    ).toEqual([
      ['first_release', true, false],
      ['hat_trick', false, true],
    ]);
  });

  it('keeps missing measurements unavailable rather than treating them as zero', () => {
    const metrics = userMetrics(
      'b',
      [{ user_id: 'b', timestamp: '2025-01-01T00:00:00Z', temp_f: null, pressure: 1010 }],
      []
    );
    expect(metrics.measurements.temp_f).toMatchObject({ count: 0, average: null });
    expect(metrics.measurements.pressure).toMatchObject({ count: 1, average: 1010 });
  });
});

it('merges repeated full-crew reconciliation without duplicating awards', () => {
  const mine = award('1', 'a', 'first_release', '2025-01-01');
  const theirs = award('2', 'b', 'hat_trick', '2025-01-02');
  const stale = award('3', 'a', 'retired_award', '2025-01-02');
  const first = mergeReconciledAwards([mine, theirs, stale], [mine, theirs], 'a');
  const again = mergeReconciledAwards(first, [mine, theirs], 'a');
  expect(again).toHaveLength(2);
  expect(new Set(again.map(row => row.id))).toEqual(new Set(['1', '2']));
  expect(mergeReconciledAwards(first, [], 'a')).toEqual([theirs]);
});
