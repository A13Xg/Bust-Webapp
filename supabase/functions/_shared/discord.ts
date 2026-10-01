/*
 * Discord webhook delivery — the Discord analogue of `_shared/push.ts`.
 *
 * Fully decoupled from the mobile-push pipeline on purpose: Discord has none
 * of web push's lock-screen fatigue concerns, so it is never subject to the
 * achievement cooldown slot or the per-bust cap in `_shared/announce.ts`. The
 * requirement is "every bust, every achievement" and this module is what makes
 * that true independently of how push notifications are paced.
 *
 * `discord_events` is its own exactly-once ledger (see
 * supabase/migrations/20260930010000_discord_webhook.sql) so a retried
 * `notify-event` call, or a race with `dispatch-push-backstop`, can never post
 * the same bust or achievement to the channel twice.
 *
 * Deliberately never imported by `dispatch-inactivity-reminders` — idle nags
 * must never reach Discord. The only callers are the two functions that route
 * through `announceBust` / `announceAchievement` in `_shared/announce.ts`.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { claimEvent, releaseEvent } from './eventLedger.ts';
import type { EventKind } from './eventLedger.ts';
import {
  buildAchievementDiscordPayload,
  buildBustDiscordPayload,
  hexToDiscordColor,
} from '../../../src/discordTemplate.js';

export type DiscordSettings = {
  enabled: boolean;
  bust_enabled: boolean;
  achievement_enabled: boolean;
  webhook_url: string | null;
  bot_username: string | null;
  bot_avatar_url: string | null;
  footer_text: string | null;
  bust_color: string | null;
  achievement_color: string | null;
  bust_title_template: string | null;
  bust_description_template: string | null;
  achievement_title_template: string | null;
  achievement_description_template: string | null;
  mention_content: string | null;
  include_thumbnail: boolean;
};

export const DEFAULT_DISCORD_SETTINGS: DiscordSettings = {
  enabled: false,
  bust_enabled: true,
  achievement_enabled: true,
  webhook_url: null,
  bot_username: null,
  bot_avatar_url: null,
  footer_text: null,
  bust_color: null,
  achievement_color: null,
  bust_title_template: null,
  bust_description_template: null,
  achievement_title_template: null,
  achievement_description_template: null,
  mention_content: null,
  include_thumbnail: true,
};

export const DISCORD_SETTINGS_TEXT_FIELDS = [
  'webhook_url',
  'bot_username',
  'bot_avatar_url',
  'footer_text',
  'bust_color',
  'achievement_color',
  'bust_title_template',
  'bust_description_template',
  'achievement_title_template',
  'achievement_description_template',
  'mention_content',
] as const;

export const DISCORD_SETTINGS_BOOLEAN_FIELDS = [
  'enabled',
  'bust_enabled',
  'achievement_enabled',
  'include_thumbnail',
] as const;

const MAX_TEXT_LENGTH: Partial<Record<(typeof DISCORD_SETTINGS_TEXT_FIELDS)[number], number>> = {
  webhook_url: 2000,
  bot_username: 80,
  bot_avatar_url: 2000,
  footer_text: 2048,
  bust_color: 7,
  achievement_color: 7,
  bust_title_template: 256,
  bust_description_template: 4096,
  achievement_title_template: 256,
  achievement_description_template: 4096,
  mention_content: 200,
};

export const DISCORD_WEBHOOK_URL_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/(\d+)\/([\w-]+)\/?$/;
const WEBHOOK_TOKEN_MASK = '••••••••••••••••';

/**
 * The webhook URL embeds a bearer-equivalent token: anyone who has it can post
 * to the channel. Never send the real token back to the browser — only the
 * (non-secret) numeric webhook id, with the token replaced by a fixed
 * placeholder. Used by both `admin-discord-settings` (so GET/UPDATE responses
 * never leak it) and `discord-test-notification` (so the preview form's
 * untouched masked field doesn't get sent back as a literal webhook URL).
 *
 * Falls back to a generic placeholder for a non-empty URL that doesn't match
 * the expected shape (a legacy host, a trailing query string, etc.) so a
 * webhook that's merely unusual still reads as "configured" instead of
 * silently vanishing from the admin UI.
 */
export function maskWebhookUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = DISCORD_WEBHOOK_URL_RE.exec(url);
  if (match) return `https://discord.com/api/webhooks/${match[2]}/${WEBHOOK_TOKEN_MASK}`;
  return `(configured) ${WEBHOOK_TOKEN_MASK}`;
}

/** `settings` with the webhook token masked — what every client-facing response sends. */
export function maskDiscordSettings<T extends { webhook_url: string | null }>(settings: T): T {
  return { ...settings, webhook_url: maskWebhookUrl(settings.webhook_url) };
}

export type DiscordSettingsValidation = { ok: true; value: Partial<DiscordSettings> } | { ok: false; error: string };

/**
 * Whitelist, type-check, length-check, and format-check a raw patch object
 * against `discord_settings`'s columns. Shared by `admin-discord-settings`
 * (persists the result) and `discord-test-notification` (merges it into a
 * preview without persisting) so arbitrary client input can never reach
 * either the database or a live webhook call unvalidated.
 */
export function validateDiscordSettingsPatch(patch: Record<string, unknown>): DiscordSettingsValidation {
  const value: Record<string, unknown> = {};

  for (const field of DISCORD_SETTINGS_BOOLEAN_FIELDS) {
    if (!(field in patch)) continue;
    if (typeof patch[field] !== 'boolean') return { ok: false, error: `${field} must be a boolean` };
    value[field] = patch[field];
  }

  for (const field of DISCORD_SETTINGS_TEXT_FIELDS) {
    if (!(field in patch)) continue;
    const raw = patch[field];
    if (raw !== null && typeof raw !== 'string') return { ok: false, error: `${field} must be a string or null` };
    const text = raw == null ? null : (raw as string).trim() || null;
    const limit = MAX_TEXT_LENGTH[field];
    if (text && limit && text.length > limit) {
      return { ok: false, error: `${field} is too long (max ${limit} characters)` };
    }
    if (text && (field === 'bust_color' || field === 'achievement_color') && hexToDiscordColor(text) == null) {
      return { ok: false, error: `${field} must be a hex color like #5865F2` };
    }
    if (text && field === 'webhook_url' && !DISCORD_WEBHOOK_URL_RE.test(text)) {
      return { ok: false, error: 'webhook_url must be a discord.com/api/webhooks/... URL' };
    }
    value[field] = text;
  }

  return { ok: true, value };
}

/** The one settings row (id = 1). Missing row means "never configured". */
export async function getDiscordSettings(admin: SupabaseClient): Promise<DiscordSettings> {
  const { data, error } = await admin.from('discord_settings').select('*').eq('id', 1).maybeSingle();
  if (error) {
    console.error('[discord] could not load settings, treating as disabled', error.message);
    return DEFAULT_DISCORD_SETTINGS;
  }
  return data ? { ...DEFAULT_DISCORD_SETTINGS, ...data } : DEFAULT_DISCORD_SETTINGS;
}

function resolveWebhookUrl(settings: DiscordSettings) {
  return (settings.webhook_url || Deno.env.get('DISCORD_WEBHOOK_URL') || '').trim();
}

/** Where the static app is hosted, for absolute asset URLs (badge sprites, avatar). */
function siteUrl() {
  return (Deno.env.get('SITE_URL') || 'https://a13xg.github.io/Bust-Webapp').trim();
}

/**
 * POST one already-built payload to a webhook URL. `?wait=true` makes Discord
 * return the created message (or an error body) synchronously instead of a
 * bare 204, which is what lets a bad webhook URL or a malformed embed surface
 * in the logs instead of vanishing.
 */
async function postToDiscordWebhook(webhookUrl: string, payload: unknown) {
  const url = `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}wait=true`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Discord webhook responded ${response.status}: ${text.slice(0, 300)}`);
  }
  return response;
}

function claimDiscordEvent(admin: SupabaseClient, kind: EventKind, sourceId: string, actorId: string | null) {
  return claimEvent(admin, 'discord_events', kind, sourceId, actorId);
}

async function releaseDiscordEvent(admin: SupabaseClient, eventId: number) {
  await releaseEvent(admin, 'discord_events', eventId);
}

async function finishDiscordEvent(
  admin: SupabaseClient,
  eventId: number,
  outcome: { success: boolean; statusCode: number | null; error: string | null }
) {
  await admin
    .from('discord_events')
    .update({
      dispatched_at: new Date().toISOString(),
      success: outcome.success,
      status_code: outcome.statusCode,
      error: outcome.error,
    })
    .eq('id', eventId);
}

export type DiscordBustContext = {
  sourceId: string;
  actorId: string | null;
  username: string;
  note?: string | null;
  city?: string | null;
  pushTitle: string;
  pushBody: string;
};

export type DiscordAchievementContext = {
  sourceId: string;
  actorId: string | null;
  username: string;
  achievementName?: string | null;
  tier?: string | null;
  points?: number | null;
  accent?: string | null;
  pushTitle: string;
  pushBody: string;
};

export type DiscordOutcome =
  { status: 'disabled' | 'unconfigured' | 'duplicate' } | { status: 'sent' } | { status: 'failed'; error: string };

/**
 * Post a webhook message for one bust or achievement, exactly once. Always
 * resolves — never throws — so a Discord outage can never take down the push
 * pipeline that calls this alongside it.
 */
export async function sendDiscordNotification(
  admin: SupabaseClient,
  kind: EventKind,
  context: DiscordBustContext | DiscordAchievementContext
): Promise<DiscordOutcome> {
  try {
    const settings = await getDiscordSettings(admin);
    if (!settings.enabled) return { status: 'disabled' };
    if (kind === 'bust' && !settings.bust_enabled) return { status: 'disabled' };
    if (kind === 'achievement' && !settings.achievement_enabled) return { status: 'disabled' };

    const webhookUrl = resolveWebhookUrl(settings);
    if (!webhookUrl) return { status: 'unconfigured' };

    const eventId = await claimDiscordEvent(admin, kind, context.sourceId, context.actorId);
    if (eventId == null) return { status: 'duplicate' };

    try {
      const payload =
        kind === 'bust'
          ? buildBustDiscordPayload({ ...context, sentAt: new Date(), siteUrl: siteUrl() }, settings)
          : buildAchievementDiscordPayload({ ...context, sentAt: new Date(), siteUrl: siteUrl() }, settings);

      const response = await postToDiscordWebhook(webhookUrl, payload);
      await finishDiscordEvent(admin, eventId, { success: true, statusCode: response.status, error: null });
      return { status: 'sent' };
    } catch (error) {
      // Release the claim so a retry (another notify-event call, or the next
      // backstop sweep) can try again instead of a transient failure silently
      // and permanently suppressing that event's Discord message.
      await releaseDiscordEvent(admin, eventId);
      const message = error instanceof Error ? error.message : String(error);
      console.error('[discord] send failed', kind, context.sourceId, message);
      return { status: 'failed', error: message };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[discord] notification pipeline failed', kind, context.sourceId, message);
    return { status: 'failed', error: message };
  }
}

/**
 * Debug-menu only: send a sample bust or achievement embed straight to the
 * webhook, using whatever settings the admin is currently previewing — which
 * may not be saved yet. Deliberately bypasses `discord_events`: a manual test
 * send has no row behind it, the same reasoning `broadcast-test-notification`
 * uses for the push ledger, and an admin tuning templates needs to be able to
 * resend freely.
 */
export async function sendDiscordTestMessage(
  kind: EventKind,
  settings: DiscordSettings,
  sample: Record<string, unknown> = {}
) {
  const webhookUrl = resolveWebhookUrl(settings);
  if (!webhookUrl) throw new Error('No webhook URL is configured (set one here, or DISCORD_WEBHOOK_URL).');

  const context = {
    sourceId: 'test',
    actorId: null,
    username: 'TestCrewMember',
    note: 'This is a test note from the admin panel.',
    city: 'Testville',
    achievementName: 'Sample Achievement',
    tier: 'gold',
    points: 50,
    accent: '#ffd166',
    pushTitle: kind === 'bust' ? 'TestCrewMember just busted' : 'TestCrewMember unlocked Sample Achievement',
    pushBody:
      kind === 'bust'
        ? 'Cooldown started. The rest of you are just standing there.'
        : 'Awarded for behavior nobody asked to be tracked.',
    sentAt: new Date(),
    siteUrl: siteUrl(),
    ...sample,
  };

  const payload =
    kind === 'bust' ? buildBustDiscordPayload(context, settings) : buildAchievementDiscordPayload(context, settings);
  const response = await postToDiscordWebhook(webhookUrl, payload);
  return { ok: true, status: response.status };
}
