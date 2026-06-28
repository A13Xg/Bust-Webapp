export const COOLDOWN_MS = 2 * 60 * 60 * 1000;

export const achievements = [
  { id: 'first_release', name: 'First Release', desc: 'Log the inaugural pressure event.' },
  { id: 'double_shift', name: 'Double Shift', desc: 'Two records in one UTC day.' },
  { id: 'night_ops', name: 'Night Ops', desc: 'Record between midnight and 4 AM.' },
  { id: 'early_bird', name: 'Early Bird', desc: 'Record between 5 AM and 8 AM.' },
  { id: 'heat_seeker', name: 'Heat Seeker', desc: 'Record above 85°F.' },
  { id: 'cold_front', name: 'Cold Front', desc: 'Record below 45°F.' },
  { id: 'high_pressure', name: 'High Pressure System', desc: 'Record above 1020 hPa.' },
  { id: 'field_reporter', name: 'Field Reporter', desc: 'Attach a note with 30+ characters.' },
  { id: 'hat_trick', name: 'Hat Trick', desc: 'Three lifetime records.' },
  { id: 'week_warrior', name: 'Week Warrior', desc: 'Five records inside seven days.' },
  { id: 'cartographer', name: 'Cartographer', desc: 'Log with coordinates attached.' }
];

export function todayKey(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

export function timeBucket(input = new Date()) {
  const h = (input instanceof Date ? input : new Date(input)).getHours();
  if (h < 4) return 'Late Night';
  if (h < 8) return 'Early Morning';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Prime Night';
}

export function twoHoursRemainingMs(lastTimestamp, now = Date.now()) {
  if (!lastTimestamp) return 0;
  return Math.max(0, COOLDOWN_MS - (now - new Date(lastTimestamp).getTime()));
}

export function computeAchievementUnlocks(userId, busts, existing = []) {
  const own = busts.filter(b => b.user_id === userId).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  const latest = own[own.length - 1];
  if (!latest) return [];
  const already = new Set(existing.filter(a => a.user_id === userId).map(a => a.achievement_type));
  const add = (id, condition) => condition && !already.has(id) ? id : null;
  const latestDate = todayKey(latest.timestamp);
  const weekAgo = new Date(latest.timestamp).getTime() - 7*24*60*60*1000;
  return [
    add('first_release', own.length >= 1),
    add('double_shift', own.filter(b => todayKey(b.timestamp) === latestDate).length >= 2),
    add('night_ops', ['Late Night'].includes(timeBucket(latest.timestamp))),
    add('early_bird', ['Early Morning'].includes(timeBucket(latest.timestamp))),
    add('heat_seeker', Number(latest.temp_f) > 85),
    add('cold_front', Number(latest.temp_f) < 45),
    add('high_pressure', Number(latest.pressure) > 1020),
    add('field_reporter', (latest.note || '').trim().length >= 30),
    add('hat_trick', own.length >= 3),
    add('week_warrior', own.filter(b => new Date(b.timestamp).getTime() >= weekAgo).length >= 5),
    add('cartographer', latest.lat != null && latest.long != null)
  ].filter(Boolean);
}
