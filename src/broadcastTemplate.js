/*
 * Templates for the debug-menu crew broadcast.
 *
 * Shared verbatim by the browser client (preview in the confirm dialog) and the
 * `broadcast-test-notification` Edge Function (the real per-recipient render),
 * so what you approve is what lands on the devices.
 *
 * Double braces on purpose. `notificationMessages.js` uses single-brace {user}
 * for hardcoded copy; this one takes free text typed by a human, and keeping the
 * syntaxes distinct means the two systems can never quietly consume each other's
 * tokens. The other deliberate difference: an unrecognised token here renders
 * LITERALLY rather than blanking, because a typo in an admin's broadcast should
 * be visible in the preview instead of silently shipping an empty sentence.
 */
import { achievements } from './rules.js';
import { INACTIVITY_MESSAGE_CATALOG, seedIndex } from './notificationMessages.js';

const achievementById = new Map(achievements.map(item => [item.id, item]));

function partsFor(date, timeZone) {
  const when = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const zone = timeZone || 'UTC';
  const pick = options => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: zone, ...options }).format(when);
    } catch {
      // An unknown IANA zone must not take the whole broadcast down.
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...options }).format(when);
    }
  };
  return {
    date: pick({ year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: pick({ hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

/*
 * Each resolver returns a string, or null to mean "not a token I can fill" —
 * which is what leaves the original text in place.
 */
export const BROADCAST_TOKENS = {
  USER: ctx => String(ctx.recipient || '').trim() || 'Someone',
  SENDER: ctx => String(ctx.sender || '').trim() || 'Control',
  CREW: ctx => String(Number.isFinite(ctx.crew) ? ctx.crew : 0),
  DATE: ctx => partsFor(ctx.sentAt, ctx.timeZone).date,
  TIME: ctx => partsFor(ctx.sentAt, ctx.timeZone).time,
  REMINDER: ctx => {
    const seed = `${ctx.sentAt instanceof Date ? ctx.sentAt.toISOString() : ''}:${ctx.recipient || ''}`;
    return INACTIVITY_MESSAGE_CATALOG[seedIndex(seed, INACTIVITY_MESSAGE_CATALOG.length)].text;
  },
  ACHIEVEMENT: (ctx, arg) => achievementById.get(String(arg || '').trim())?.name ?? null,
};

const TOKEN_RE = /\{\{\s*([A-Za-z_]+)(?::([^}]*?))?\s*\}\}/g;

/**
 * Render one template for one recipient. Single pass: a token that appears
 * inside a substituted value is left alone rather than expanded again.
 */
export function renderBroadcast(template, context = {}) {
  return String(template ?? '').replace(TOKEN_RE, (match, name, arg) => {
    const resolver = BROADCAST_TOKENS[String(name).toUpperCase()];
    if (!resolver) return match;
    const value = resolver(context, arg);
    return value == null ? match : String(value);
  });
}

/** Tokens the renderer would leave literal — surfaced in the confirm dialog. */
export function unknownTokens(template) {
  const found = [];
  for (const match of String(template ?? '').matchAll(TOKEN_RE)) {
    const resolver = BROADCAST_TOKENS[String(match[1]).toUpperCase()];
    const unresolved = !resolver || resolver({ recipient: 'x', sender: 'x', crew: 0 }, match[2]) == null;
    if (unresolved && !found.includes(match[0])) found.push(match[0]);
  }
  return found;
}

/** Cheat sheet rendered in the debug menu's Notify tab. */
export function describeTokens() {
  return [
    { token: '{{USER}}', hint: "the recipient's own name — differs per device" },
    { token: '{{SENDER}}', hint: 'you, whoever sends the broadcast' },
    { token: '{{CREW}}', hint: 'how many devices it went to' },
    { token: '{{DATE}}', hint: 'send date, e.g. 2026-09-08' },
    { token: '{{TIME}}', hint: 'send time, 24h, e.g. 17:30' },
    { token: '{{REMINDER}}', hint: 'a random inactivity nag from the catalog' },
    { token: '{{ACHIEVEMENT:hat_trick}}', hint: 'an achievement id → its display name' },
  ];
}
