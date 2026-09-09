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
  { text: 'The BUST button misses you!.', weight: 5 },
  { text: 'Your cooldown ended days ago. At this point the lack of BUSTING appears deliberate.', weight: 5 },
  { text: 'The BUST button has filed a missing persons report.', weight: 4 },
  { text: 'The BUST button misses you!.', weight: 4 },
  { text: 'Still nothing? Bold strategy for someone that is KNOWN to be a BUSTer.', weight: 4 },
  { text: 'Mission update: There isnt one because you cant be bothered to BUST.', weight: 4 },
  { text: 'Can you even get it up anymore...?', weight: 4 },
  { text: 'Have you forgotten how that thing works?', weight: 4 },
  { text: 'Scientists have classified your BUST capability as "theoretical".', weight: 3 },
  { text: 'This app works substantially better when you actually use it.', weight: 3 },
  { text: 'Your silence has been logged as infertility by default.', weight: 3 },
  { text: 'Somewhere one of the men is filling up their belly-button... and here you are-NOT BUSTING.', weight: 3 },
  { text: 'You have achieved peak inactivity. They make pills for that ya know?', weight: 2 },
  { text: 'Your inactivity streak is embarassing tbqh', weight: 2 },
  { text: 'Go CRANK one out for the bois.', weight: 2 },
  { text: 'Youve gone a while without a BUST.', weight: 2 },
  { text: 'The BUST database is judging you.', weight: 2 },
  { text: 'Rumor has it you dont even know where it is anymore.', weight: 2 },
  { text: 'Not a single Hog Crank in sight...', weight: 2 },
  { text: 'Jerk one out for the bois.', weight: 1 },
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
