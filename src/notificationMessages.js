/*
 * Notification copy, shared verbatim by the browser client and the Supabase
 * Edge Functions so a bust reads the same whether it arrives via realtime or
 * via web push.
 *
 * Variant selection is seeded from the event id rather than Math.random(), so
 * the same bust never produces two different notifications on two devices.
 */

export const BUST_TITLES = [
  '{user} just busted',
  'Pressure event: {user}',
  '{user} pulled the trigger',
  'Incoming from {user}',
  '{user} did the thing',
  'Detonation logged: {user}',
];

export const BUST_BODIES = [
  'Cooldown started. The rest of you are just standing there.',
  'Logged, timestamped, and impossible to take back.',
  'That is one for the record books and zero for the rest of you.',
  'The leaderboard shifted. Slightly. Menacingly.',
  'Seismographs unbothered. Leaderboard extremely bothered.',
  'Another data point in humanity’s least necessary dataset.',
  'Two hours of smug silence begins now.',
  'The button has been pressed. The prophecy continues.',
  'Meanwhile, your own cooldown is doing absolutely nothing.',
  'Somebody is productive today and it is not you.',
];

export const ACHIEVEMENT_TITLES = [
  '{user} unlocked {name}',
  '{name} — claimed by {user}',
  '{user} earned {name}',
  'New hardware for {user}: {name}',
];

export const ACHIEVEMENT_BODIES = [
  'Awarded for behavior nobody asked to be tracked.',
  'The trophy cabinet grows. So does the concern.',
  'Certified, notarized, and completely meaningless.',
  'Add it to the pile. The pile is getting weird.',
  'Skill? Luck? Poor scheduling? The badge does not care.',
  'Somewhere, a spreadsheet is proud.',
];

/*
 * Inactivity nags. Weight is a rough "how often should this show up" dial;
 * the sharper jokes are rationed so they stay funny.
 */
export const INACTIVITY_MESSAGE_CATALOG = [
  { text: 'Your cooldown ended days ago. At this point the inactivity appears deliberate.', weight: 5 },
  { text: 'The BUST button has filed a missing persons report.', weight: 4 },
  { text: 'Still nothing. Bold strategy for a pressure logger.', weight: 4 },
  { text: 'Mission update: absolutely nothing has happened because of you.', weight: 4 },
  { text: 'Impressive discipline. In all the wrong places.', weight: 4 },
  { text: 'The crew logged busts this week. You logged vibes.', weight: 4 },
  { text: 'Your last bust is now old enough to have opinions.', weight: 3 },
  { text: 'We checked the leaderboard for you. Do not check the leaderboard.', weight: 3 },
  { text: 'Scientists have classified your streak as "theoretical".', weight: 3 },
  { text: 'This app works substantially better when you actually use it.', weight: 3 },
  { text: 'Your silence has been logged as tactical procrastination.', weight: 3 },
  { text: 'Somewhere a barometer is falling. Unrelated. Probably.', weight: 3 },
  { text: 'You have achieved peak inactivity. Congratulations, I guess.', weight: 2 },
  { text: 'Your inactivity streak is comfortably your strongest stat.', weight: 2 },
  { text: 'The button is right there. It has been right there this whole time.', weight: 2 },
  { text: 'Consider this a wellness check with a leaderboard attached.', weight: 2 },
  { text: 'Nobody is judging you. The database is judging you.', weight: 2 },
  { text: 'Rumor has it you have forgotten how the button works.', weight: 2 },
  { text: 'Reminder: legacy is built two hours at a time.', weight: 2 },
  { text: 'We are not angry. We are simply keeping detailed records.', weight: 1 },
];

/** Small stable string hash so client and server pick the same variant. */
export function seedIndex(seed, length) {
  if (!length) return 0;
  const text = String(seed ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % length;
}

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

/** Notification payload for "someone else busted". */
export function buildBustNotification({ username, note, bustId, city } = {}) {
  const user = String(username || 'Someone').trim() || 'Someone';
  const seed = bustId || `${user}:${note || ''}`;
  const trimmedNote = String(note || '').trim();
  const suffix = city ? ` · ${city}` : '';
  return {
    title: fill(BUST_TITLES[seedIndex(`t:${seed}`, BUST_TITLES.length)], { user }),
    body: trimmedNote
      ? `“${trimmedNote}”${suffix}`
      : `${BUST_BODIES[seedIndex(`b:${seed}`, BUST_BODIES.length)]}${suffix}`,
    tag: `bust-${bustId || seed}`,
    kind: 'bust',
  };
}

/** Notification payload for "someone else unlocked an achievement". */
export function buildAchievementNotification({ username, achievementName, achievementId, tier } = {}) {
  const user = String(username || 'Someone').trim() || 'Someone';
  const name = String(achievementName || achievementId || 'a new badge').trim();
  const seed = `${user}:${achievementId || name}`;
  return {
    title: fill(ACHIEVEMENT_TITLES[seedIndex(`t:${seed}`, ACHIEVEMENT_TITLES.length)], { user, name }),
    body: ACHIEVEMENT_BODIES[seedIndex(`b:${seed}`, ACHIEVEMENT_BODIES.length)],
    tag: `achievement-${user}-${achievementId || name}`,
    kind: 'achievement',
    tier: tier || null,
  };
}
