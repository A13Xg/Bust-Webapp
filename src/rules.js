export const COOLDOWN_MS = 2 * 60 * 60 * 1000;

const legacyAchievements = [
  { id: 'first_release', name: 'First Release', desc: 'Log the inaugural pressure event.', tier: 'bronze', kind: 'achievement', track: 'legacy', icon: 'Sparkles', points: 10, accent: '#ff8a2a', goal: 1 },
  { id: 'double_shift', name: 'Double Shift', desc: 'Two records in one UTC day.', tier: 'silver', kind: 'badge', track: 'legacy', icon: 'Repeat2', points: 25, accent: '#f8c471', goal: 2 },
  { id: 'night_ops', name: 'Night Ops', desc: 'Record between midnight and 4 AM.', tier: 'silver', kind: 'achievement', track: 'legacy', icon: 'Moon', points: 25, accent: '#8ab4ff', goal: 1 },
  { id: 'early_bird', name: 'Early Bird', desc: 'Record between 5 AM and 8 AM.', tier: 'bronze', kind: 'achievement', track: 'legacy', icon: 'Sunrise', points: 15, accent: '#ffd166', goal: 1 },
  { id: 'heat_seeker', name: 'Heat Seeker', desc: 'Record above 85°F.', tier: 'gold', kind: 'achievement', track: 'legacy', icon: 'Flame', points: 40, accent: '#ff4d2e', goal: 1 },
  { id: 'cold_front', name: 'Cold Front', desc: 'Record below 45°F.', tier: 'gold', kind: 'achievement', track: 'legacy', icon: 'Snowflake', points: 40, accent: '#7bdff2', goal: 1 },
  { id: 'high_pressure', name: 'High Pressure System', desc: 'Record above 1020 hPa.', tier: 'gold', kind: 'achievement', track: 'legacy', icon: 'Gauge', points: 45, accent: '#c77dff', goal: 1 },
  { id: 'field_reporter', name: 'Field Reporter', desc: 'Attach a note with 30+ characters.', tier: 'bronze', kind: 'achievement', track: 'legacy', icon: 'NotebookPen', points: 15, accent: '#95d5b2', goal: 1 },
  { id: 'hat_trick', name: 'Hat Trick', desc: 'Three lifetime records.', tier: 'silver', kind: 'badge', track: 'legacy', icon: 'BadgeCheck', points: 30, accent: '#f5f0e8', goal: 3 },
  { id: 'week_warrior', name: 'Week Warrior', desc: 'Five records inside seven days.', tier: 'platinum', kind: 'trophy', track: 'legacy', icon: 'CalendarDays', points: 75, accent: '#e0aaff', goal: 5 },
  { id: 'cartographer', name: 'Cartographer', desc: 'Log with coordinates attached.', tier: 'bronze', kind: 'achievement', track: 'legacy', icon: 'MapPinned', points: 20, accent: '#57cc99', goal: 1 }
];

function stage(track, kind, name, desc, goal, tier, icon, points, accent) {
  return { id: `${track}_${kind}`, track, kind, name, desc, goal, tier, icon, points, accent };
}

export const progressionCatalog = [
  { id: 'scorcher', name: 'Scorcher Circuit', desc: 'Extreme heat logging above 100°F.', accent: '#ff3b1f', icon: 'Flame', stages: [
    stage('scorcher', 'achievement', 'Triple-Digit Heat', 'Bust once in weather over 100°F.', 1, 'gold', 'Flame', 50, '#ff3b1f'),
    stage('scorcher', 'badge', 'Heat Dome Habit', 'Bust 10 times in weather over 100°F.', 10, 'platinum', 'Sun', 140, '#ff6b35'),
    stage('scorcher', 'trophy', 'The Molten Chalice', 'Bust 25 times in weather over 100°F.', 25, 'mythic', 'Trophy', 320, '#ffd166')
  ]},
  { id: 'daypart', name: 'Daypart Dominion', desc: 'Cover morning, noon, and night.', accent: '#9bf6ff', icon: 'Sunrise', stages: [
    stage('daypart', 'achievement', 'Clockwatcher', 'Bust in any two distinct dayparts.', 2, 'bronze', 'Clock3', 25, '#9bf6ff'),
    stage('daypart', 'badge', 'Morning Noon Night', 'Bust at morning, noon, and night.', 3, 'gold', 'Sunrise', 95, '#ffd166'),
    stage('daypart', 'trophy', 'Circadian Crown', 'Bust in all six time-of-day buckets.', 6, 'mythic', 'Crown', 240, '#e0aaff')
  ]},
  { id: 'marathon', name: 'Volume Marathon', desc: 'Lifetime total pressure events.', accent: '#ff8a2a', icon: 'Activity', stages: [
    stage('marathon', 'achievement', 'Regular Operator', 'Reach 5 lifetime busts.', 5, 'bronze', 'BadgeCheck', 45, '#ff8a2a'),
    stage('marathon', 'badge', 'Serial Dripper', 'Reach 25 lifetime busts.', 25, 'platinum', 'Medal', 160, '#f8c471'),
    stage('marathon', 'trophy', 'All-Time Fountain', 'Reach 100 lifetime busts.', 100, 'mythic', 'Trophy', 500, '#fff8e7')
  ]},
  { id: 'weekend', name: 'Weekend Warrior', desc: 'Saturday and Sunday consistency.', accent: '#57cc99', icon: 'CalendarDays', stages: [
    stage('weekend', 'achievement', 'Saturday Splash', 'Bust on a Saturday.', 1, 'bronze', 'CalendarDays', 20, '#57cc99'),
    stage('weekend', 'badge', 'Full Weekend', 'Bust on both Saturday and Sunday.', 2, 'silver', 'CalendarDays', 70, '#95d5b2'),
    stage('weekend', 'trophy', 'Weekend Warlord', 'Log 10 weekend busts.', 10, 'platinum', 'Crown', 190, '#b7e4c7')
  ]},
  { id: 'pressure', name: 'Pressure System', desc: 'High barometric-pressure moments.', accent: '#c77dff', icon: 'Gauge', stages: [
    stage('pressure', 'achievement', 'Rising Barometer', 'Bust once above 1020 hPa.', 1, 'gold', 'Gauge', 45, '#c77dff'),
    stage('pressure', 'badge', 'High Pressure Habit', 'Bust 5 times above 1020 hPa.', 5, 'platinum', 'Gauge', 120, '#e0aaff'),
    stage('pressure', 'trophy', 'Atmospheric Monarch', 'Bust 15 times above 1020 hPa.', 15, 'mythic', 'Crown', 280, '#f5f0e8')
  ]},
  { id: 'cold', name: 'Cold Front', desc: 'Low-temperature defiance.', accent: '#7bdff2', icon: 'Snowflake', stages: [
    stage('cold', 'achievement', 'Frosted Release', 'Bust once below 45°F.', 1, 'gold', 'Snowflake', 45, '#7bdff2'),
    stage('cold', 'badge', 'Ice Bath Badge', 'Bust 5 times below 45°F.', 5, 'platinum', 'Snowflake', 130, '#9bf6ff'),
    stage('cold', 'trophy', 'The Frozen Goblet', 'Bust 15 times below 45°F.', 15, 'mythic', 'Trophy', 300, '#caf0f8')
  ]},
  { id: 'scribe', name: 'Field Notes', desc: 'Humorous long-form notes.', accent: '#95d5b2', icon: 'NotebookPen', stages: [
    stage('scribe', 'achievement', 'Field Reporter', 'Attach a note with 30+ characters.', 1, 'bronze', 'NotebookPen', 15, '#95d5b2'),
    stage('scribe', 'badge', 'Lorekeeper', 'Attach 10 notes with 30+ characters.', 10, 'gold', 'NotebookPen', 105, '#57cc99'),
    stage('scribe', 'trophy', 'Canon Archivist', 'Attach 30 notes with 30+ characters.', 30, 'mythic', 'Crown', 260, '#d8f3dc')
  ]},
  { id: 'cartographer', name: 'Cartography', desc: 'Location-backed logging.', accent: '#57cc99', icon: 'MapPinned', stages: [
    stage('cartographer', 'achievement', 'Map Dot', 'Bust once with coordinates attached.', 1, 'bronze', 'MapPinned', 20, '#57cc99'),
    stage('cartographer', 'badge', 'Puddle Mapper', 'Bust 10 times with coordinates attached.', 10, 'gold', 'MapPinned', 115, '#80ed99'),
    stage('cartographer', 'trophy', 'Global Spill Atlas', 'Bust 25 times with coordinates attached.', 25, 'mythic', 'Trophy', 290, '#b7e4c7')
  ]},
  { id: 'streak', name: 'Weekly Streak', desc: 'Seven-day concentration.', accent: '#e0aaff', icon: 'Repeat2', stages: [
    stage('streak', 'achievement', 'Double Shift', 'Two records in one local day.', 2, 'silver', 'Repeat2', 25, '#f8c471'),
    stage('streak', 'badge', 'Week Warrior', 'Five records inside seven days.', 5, 'platinum', 'CalendarDays', 75, '#e0aaff'),
    stage('streak', 'trophy', 'Seven-Day Storm', 'Ten records inside seven days.', 10, 'mythic', 'Trophy', 230, '#c77dff')
  ]},
  { id: 'night', name: 'Night Shift', desc: 'Late-night activity.', accent: '#8ab4ff', icon: 'Moon', stages: [
    stage('night', 'achievement', 'Night Ops', 'Bust once between midnight and 4 AM.', 1, 'silver', 'Moon', 25, '#8ab4ff'),
    stage('night', 'badge', 'Moonlit Habit', 'Bust 7 times between midnight and 4 AM.', 7, 'gold', 'Moon', 120, '#bde0fe'),
    stage('night', 'trophy', 'Midnight Chalice', 'Bust 20 times between midnight and 4 AM.', 20, 'mythic', 'Trophy', 300, '#a2d2ff')
  ]}
];

export const achievements = [...legacyAchievements, ...progressionCatalog.flatMap(track => track.stages)];

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

function daypart(input) {
  const bucket = timeBucket(input);
  if (bucket === 'Early Morning' || bucket === 'Morning') return 'morning';
  if (bucket === 'Afternoon') return 'noon';
  return 'night';
}

export function twoHoursRemainingMs(lastTimestamp, now = Date.now()) {
  if (!lastTimestamp) return 0;
  return Math.max(0, COOLDOWN_MS - (now - new Date(lastTimestamp).getTime()));
}

function progressFor(trackId, own) {
  const latest = own[own.length - 1];
  const latestDate = latest ? todayKey(latest.timestamp) : null;
  const weekAgo = latest ? new Date(latest.timestamp).getTime() - 7*24*60*60*1000 : 0;
  const countWhere = (fn) => own.filter(fn).length;
  const unique = (fn) => new Set(own.map(fn).filter(Boolean)).size;
  switch (trackId) {
    case 'scorcher': return countWhere(b => Number(b.temp_f) > 100);
    case 'daypart': return unique(b => daypart(b.timestamp));
    case 'marathon': return own.length;
    case 'weekend': return Math.max(unique(b => [0,6].includes(new Date(b.timestamp).getDay()) ? new Date(b.timestamp).getDay() : null), countWhere(b => [0,6].includes(new Date(b.timestamp).getDay())));
    case 'pressure': return countWhere(b => Number(b.pressure) > 1020);
    case 'cold': return countWhere(b => Number(b.temp_f) < 45);
    case 'scribe': return countWhere(b => (b.note || '').trim().length >= 30);
    case 'cartographer': return countWhere(b => b.lat != null && b.long != null);
    case 'streak': return Math.max(countWhere(b => latestDate && todayKey(b.timestamp) === latestDate), countWhere(b => new Date(b.timestamp).getTime() >= weekAgo));
    case 'night': return countWhere(b => timeBucket(b.timestamp) === 'Late Night');
    default: return 0;
  }
}

function alreadyUnlocked(existing, userId) {
  return new Set(existing.filter(a => a.user_id === userId).map(a => a.achievement_type));
}

export function computeProgressionUnlocks(userId, busts, existing = []) {
  const own = busts.filter(b => b.user_id === userId).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  if (!own.length) return [];
  const already = alreadyUnlocked(existing, userId);
  return progressionCatalog.flatMap(track => {
    const progress = progressFor(track.id, own);
    return track.stages.filter(item => progress >= item.goal && !already.has(item.id)).map(item => item.id);
  });
}

export function computeAchievementUnlocks(userId, busts, existing = []) {
  const own = busts.filter(b => b.user_id === userId).sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  const latest = own[own.length - 1];
  if (!latest) return [];
  const already = alreadyUnlocked(existing, userId);
  const add = (id, condition) => condition && !already.has(id) ? id : null;
  const latestDate = todayKey(latest.timestamp);
  const weekAgo = new Date(latest.timestamp).getTime() - 7*24*60*60*1000;
  const legacy = [
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
  return [...legacy, ...computeProgressionUnlocks(userId, busts, existing)].filter((id, index, all) => all.indexOf(id) === index);
}

export function deriveProgressionSummary(userId, existing = []) {
  const unlockedIds = alreadyUnlocked(existing, userId);
  const tracks = progressionCatalog.map(track => {
    const reachedIndex = Math.max(-1, ...track.stages.map((stage, index) => unlockedIds.has(stage.id) ? index : -1));
    const unlocked = reachedIndex + 1;
    const points = track.stages.slice(0, unlocked).reduce((sum, item) => sum + item.points, 0);
    return { ...track, unlocked, total: track.stages.length, percent: Math.round(unlocked / track.stages.length * 100), points };
  });
  const totalUnlocked = tracks.reduce((sum, track) => sum + track.unlocked, 0);
  const totalItems = progressionCatalog.reduce((sum, track) => sum + track.stages.length, 0);
  return { totalUnlocked, totalItems, totalPoints: tracks.reduce((sum, track) => sum + track.points, 0), tracks };
}

export function deriveAllTimeRecords(busts = []) {
  const safeBusts = busts.filter(Boolean);
  const counts = new Map();
  for (const bust of safeBusts) {
    const key = bust.username || bust.user_id || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const volume = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const withTemp = safeBusts.filter(b => b.temp_f != null && !Number.isNaN(Number(b.temp_f)));
  const withPressure = safeBusts.filter(b => b.pressure != null && !Number.isNaN(Number(b.pressure)));
  const coldest = [...withTemp].sort((a, b) => Number(a.temp_f) - Number(b.temp_f))[0];
  const pressurePeak = [...withPressure].sort((a, b) => Number(b.pressure) - Number(a.pressure))[0];
  const earliest = [...safeBusts].sort((a, b) => {
    const ad = new Date(a.timestamp); const bd = new Date(b.timestamp);
    return ad.getHours() * 60 + ad.getMinutes() - (bd.getHours() * 60 + bd.getMinutes());
  })[0];

  return [
    { id: 'volume_king', label: 'Volume King', value: volume?.[0] || '—', detail: volume ? `${volume[1]} total records` : 'No events yet', icon: 'Crown' },
    { id: 'coldest_bust', label: 'Coldest Bust', value: coldest ? `${Math.round(Number(coldest.temp_f))}°F` : '—', detail: coldest ? `${coldest.username || 'Unknown'} · ${timeBucket(coldest.timestamp)}` : 'Awaiting weather data', icon: 'Snowflake' },
    { id: 'pressure_peak', label: 'Pressure Peak', value: pressurePeak ? `${Math.round(Number(pressurePeak.pressure))} hPa` : '—', detail: pressurePeak ? `${pressurePeak.username || 'Unknown'} · ${timeBucket(pressurePeak.timestamp)}` : 'Awaiting pressure data', icon: 'Gauge' },
    { id: 'earliest_bust', label: 'Earliest Bust', value: earliest ? new Date(earliest.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—', detail: earliest ? `${earliest.username || 'Unknown'} · ${timeBucket(earliest.timestamp)}` : 'No events yet', icon: 'AlarmClock' }
  ];
}
