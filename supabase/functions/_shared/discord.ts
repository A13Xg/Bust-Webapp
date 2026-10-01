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
import {
  buildAchievementDiscordPayload,
  buildBustDiscordPayload,
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

/** The one settings row (id = true). Missing row means "never configured". */
export async function getDiscordSettings(admin: SupabaseClient): Promise<DiscordSettings> {
  const { data, error } = await admin.from('discord_settings').select('*').eq('id', true).maybeSingle();
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

async function claimDiscordEvent(admin: SupabaseClient, kind: 'bust' | 'achievement', sourceId: string, actorId: string | null) {
  const { data, error } = await admin
    .from('discord_events')
    .insert({ kind, source_id: sourceId, actor_id: actorId })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return null; // already claimed — not an error
    throw new Error(error.message);
  }
  return data?.id ?? null;
}

async function releaseDiscordEvent(admin: SupabaseClient, eventId: number) {
  const { error } = await admin.from('discord_events').delete().eq('id', eventId);
  if (error) console.error('[discord] could not release claim', eventId, error.message);
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
  | { status: 'disabled' | 'unconfigured' | 'duplicate' }
  | { status: 'sent' }
  | { status: 'failed'; error: string };

/**
 * Post a webhook message for one bust or achievement, exactly once. Always
 * resolves — never throws — so a Discord outage can never take down the push
 * pipeline that calls this alongside it.
 */
export async function sendDiscordNotification(
  admin: SupabaseClient,
  kind: 'bust' | 'achievement',
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
  kind: 'bust' | 'achievement',
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
    pushBody: kind === 'bust' ? 'Cooldown started. The rest of you are just standing there.' : 'Awarded for behavior nobody asked to be tracked.',
    sentAt: new Date(),
    siteUrl: siteUrl(),
    ...sample,
  };

  const payload =
    kind === 'bust' ? buildBustDiscordPayload(context, settings) : buildAchievementDiscordPayload(context, settings);
  const response = await postToDiscordWebhook(webhookUrl, payload);
  return { ok: true, status: response.status };
}
