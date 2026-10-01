/*
 * Discord webhook message templates.
 *
 * Shared verbatim by the browser client (admin settings preview in the debug
 * menu) and the `admin-discord-settings` / `_shared/discord.ts` Edge Functions,
 * so the embed an admin previews is the embed that ships.
 *
 * Token syntax deliberately matches `broadcastTemplate.js` ({{TOKEN}}, double
 * braces) for familiarity, but this is its own token set — a Discord template
 * is rendered once per EVENT, not once per recipient, so there is no per-user
 * {{USER}} meaning "whoever is reading this"; here {{USER}} is always the
 * crew member who busted or unlocked the achievement.
 *
 * {{PUSH_TITLE}} / {{PUSH_BODY}} expose the exact strings
 * `notificationMessages.js` generated for the mobile push, so the default
 * templates below read the same everywhere without duplicating the joke
 * catalogs — and an admin who customises the Discord copy can still fall back
 * to them for a line they didn't bother to override.
 */
import { renderTokens, unknownTemplateTokens } from './templateTokens.js';
import { partsFor } from './broadcastTemplate.js';

/** Discord's own brand color (blurple), used when nothing else is configured. */
export const DEFAULT_BUST_COLOR = '#5865F2';
export const DEFAULT_ACHIEVEMENT_COLOR = '#F1C40F';
export const DEFAULT_BOT_USERNAME = 'BUST Control';

export const DEFAULT_BUST_TITLE_TEMPLATE = '💥 {{PUSH_TITLE}}';
export const DEFAULT_BUST_DESCRIPTION_TEMPLATE = '{{PUSH_BODY}}';
export const DEFAULT_ACHIEVEMENT_TITLE_TEMPLATE = '🏆 {{PUSH_TITLE}}';
export const DEFAULT_ACHIEVEMENT_DESCRIPTION_TEMPLATE = '{{PUSH_BODY}}';
export const DEFAULT_FOOTER_TEXT = 'BUST';

/* Each resolver returns a string, or null to mean "not a token I can fill" —
 * which is what leaves the original text in place so a typo stays visible. */
export const DISCORD_TOKENS = {
  USER: ctx => String(ctx.username || '').trim() || 'Someone',
  NOTE: ctx => String(ctx.note || '').trim(),
  CITY: ctx => String(ctx.city || '').trim(),
  DATE: ctx => partsFor(ctx.sentAt, ctx.timeZone).date,
  TIME: ctx => partsFor(ctx.sentAt, ctx.timeZone).time,
  ACHIEVEMENT: ctx => String(ctx.achievementName || '').trim(),
  TIER: ctx => (ctx.tier ? String(ctx.tier).replace(/\b\w/g, c => c.toUpperCase()) : ''),
  POINTS: ctx => (Number.isFinite(ctx.points) ? String(ctx.points) : ''),
  PUSH_TITLE: ctx => String(ctx.pushTitle || ''),
  PUSH_BODY: ctx => String(ctx.pushBody || ''),
};

export function renderDiscordTemplate(template, context = {}) {
  return renderTokens(DISCORD_TOKENS, template, context);
}

/** Tokens the renderer would leave literal — surfaced in the admin preview. */
export function unknownDiscordTokens(template) {
  return unknownTemplateTokens(DISCORD_TOKENS, template, {
    username: 'x',
    note: 'x',
    city: 'x',
    achievementName: 'x',
    tier: 'bronze',
    points: 0,
    pushTitle: 'x',
    pushBody: 'x',
  });
}

/** Cheat sheet for the admin's Discord settings tab. */
export function describeDiscordTokens() {
  return [
    { token: '{{USER}}', hint: 'whoever busted or unlocked the achievement' },
    { token: '{{NOTE}}', hint: "the bust's attached note, blank if none" },
    { token: '{{CITY}}', hint: "the bust's city, blank if not shared" },
    { token: '{{DATE}}', hint: 'event date, e.g. 2026-09-08' },
    { token: '{{TIME}}', hint: 'event time, 24h, e.g. 17:30' },
    { token: '{{ACHIEVEMENT}}', hint: 'the unlocked achievement\u2019s display name' },
    { token: '{{TIER}}', hint: 'the achievement\u2019s tier, e.g. Gold' },
    { token: '{{POINTS}}', hint: "the achievement's point value" },
    { token: '{{PUSH_TITLE}}', hint: 'the exact title the mobile push used' },
    { token: '{{PUSH_BODY}}', hint: 'the exact body the mobile push used' },
  ];
}

/** "#5865F2" -> 5786674, the integer form the Discord API wants for embed color. */
export function hexToDiscordColor(hex) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
  return match ? parseInt(match[1], 16) : null;
}

const badgeFileFor = tier => `badges/512/${String(tier || 'bronze').toLowerCase()}.png`;

/** Absolute URL to a tier's badge sprite, hosted alongside the static app. */
export function badgeImageUrl(tier, siteUrl) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/${badgeFileFor(tier)}`;
}

/**
 * Build the full `POST /webhooks/{id}/{token}` JSON body for a bust.
 * `settings` is a (possibly partial) row from `discord_settings`; any field
 * left unset falls back to the defaults above.
 */
export function buildBustDiscordPayload(ctx, settings = {}) {
  const title = renderDiscordTemplate(settings.bust_title_template || DEFAULT_BUST_TITLE_TEMPLATE, ctx);
  const description = renderDiscordTemplate(
    settings.bust_description_template || DEFAULT_BUST_DESCRIPTION_TEMPLATE,
    ctx
  );
  const fields = [];
  if (String(ctx.city || '').trim()) fields.push({ name: 'City', value: String(ctx.city).trim(), inline: true });
  return assemblePayload(settings, {
    title,
    description,
    color: hexToDiscordColor(settings.bust_color) ?? hexToDiscordColor(DEFAULT_BUST_COLOR),
    fields,
    thumbnailUrl: null,
    sentAt: ctx.sentAt,
  });
}

/** Same, for an achievement unlock — includes the tier badge sprite as a thumbnail. */
export function buildAchievementDiscordPayload(ctx, settings = {}) {
  const title = renderDiscordTemplate(settings.achievement_title_template || DEFAULT_ACHIEVEMENT_TITLE_TEMPLATE, ctx);
  const description = renderDiscordTemplate(
    settings.achievement_description_template || DEFAULT_ACHIEVEMENT_DESCRIPTION_TEMPLATE,
    ctx
  );
  const fields = [];
  if (ctx.tier) fields.push({ name: 'Tier', value: DISCORD_TOKENS.TIER(ctx), inline: true });
  if (Number.isFinite(ctx.points)) fields.push({ name: 'Points', value: String(ctx.points), inline: true });
  const color =
    hexToDiscordColor(settings.achievement_color) ??
    hexToDiscordColor(ctx.accent) ??
    hexToDiscordColor(DEFAULT_ACHIEVEMENT_COLOR);
  const thumbnailUrl = settings.include_thumbnail === false ? null : badgeImageUrl(ctx.tier, ctx.siteUrl);
  return assemblePayload(settings, { title, description, color, fields, thumbnailUrl, sentAt: ctx.sentAt });
}

function assemblePayload(settings, { title, description, color, fields, thumbnailUrl, sentAt }) {
  const embed = {
    title: title || undefined,
    description: description || undefined,
    color: color ?? undefined,
    fields: fields.length ? fields : undefined,
    footer: { text: String(settings.footer_text || DEFAULT_FOOTER_TEXT) },
    timestamp: (sentAt instanceof Date && !Number.isNaN(sentAt.getTime()) ? sentAt : new Date()).toISOString(),
  };
  if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };
  const payload = {
    username: String(settings.bot_username || DEFAULT_BOT_USERNAME).slice(0, 80) || undefined,
    avatar_url: settings.bot_avatar_url || undefined,
    content: String(settings.mention_content || '').trim() || undefined,
    embeds: [embed],
    allowed_mentions: { parse: ['everyone', 'roles', 'users'] },
  };
  return payload;
}
