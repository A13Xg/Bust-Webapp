import { achievements, derivePersonalStats, buildTrend, finiteNumber } from './rules.js';

const catalog = new Map(achievements.map(item => [item.id, item]));

export function earnedRecords(rows, userId) {
  const byType = new Map();
  for (const row of rows) {
    if (row.user_id !== userId || row.debug || !row.achievement_type) continue;
    const current = byType.get(row.achievement_type);
    if (!current || Date.parse(row.unlocked_at) > Date.parse(current.unlocked_at))
      byType.set(row.achievement_type, row);
  }
  return [...byType.values()]
    .map(row => ({
      ...row,
      item: catalog.get(row.achievement_type) || {
        id: row.achievement_type,
        name: `Historical unlock: ${row.achievement_type}`,
        desc: 'This award is not in the current catalog.',
        tier: 'unknown',
        kind: 'historical',
        icon: 'Medal',
        points: null,
      },
    }))
    .sort((a, b) => {
      const ta = Date.parse(a.unlocked_at),
        tb = Date.parse(b.unlocked_at);
      return (
        (Number.isFinite(tb) ? tb : -Infinity) - (Number.isFinite(ta) ? ta : -Infinity) ||
        String(b.id).localeCompare(String(a.id))
      );
    });
}

export function comparisonRows(rows, viewerId, subjectId) {
  const mine = new Map(earnedRecords(rows, viewerId).map(record => [record.achievement_type, record]));
  const theirs = new Map(earnedRecords(rows, subjectId).map(record => [record.achievement_type, record]));
  return [...new Set([...mine.keys(), ...theirs.keys()])].sort().map(id => ({
    id,
    item: mine.get(id)?.item || theirs.get(id)?.item,
    viewerEarned: mine.has(id),
    subjectEarned: theirs.has(id),
  }));
}

export function userMetrics(userId, busts, unlocks) {
  const own = busts.filter(row => row.user_id === userId);
  const earned = earnedRecords(unlocks, userId);
  const stats = derivePersonalStats(userId, own, earned);
  const measurements = Object.fromEntries(
    [
      ['temp_f', '°F'],
      ['pressure', 'hPa'],
      ['tide_ft', 'ft'],
      ['elevation_ft', 'ft'],
      ['btc_usd', 'USD'],
    ].map(([key, unit]) => {
      const values = own.map(row => finiteNumber(row[key])).filter(value => value != null);
      return [
        key,
        {
          unit,
          count: values.length,
          average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
          min: values.length ? values.reduce((minimum, value) => Math.min(minimum, value), Infinity) : null,
          max: values.length ? values.reduce((maximum, value) => Math.max(maximum, value), -Infinity) : null,
        },
      ];
    })
  );
  return {
    own,
    earned,
    stats,
    measurements,
    trend: buildTrend(own, 30),
    xpIncomplete: earned.some(record => record.item.points == null),
  };
}

/** Reconciliation replaces this user's history but may include the whole crew.
 * Merge by row ID so repeated responses cannot inflate another user's XP. */
export function mergeReconciledAwards(previous, reconciled, userId) {
  return [
    ...new Map([...previous.filter(row => row.user_id !== userId), ...reconciled].map(row => [row.id, row])).values(),
  ];
}
