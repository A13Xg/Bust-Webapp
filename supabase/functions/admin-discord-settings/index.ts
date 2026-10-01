/*
 * admin-discord-settings — debug-menu only.
 *
 * Reads and writes the single `discord_settings` row that controls the
 * Discord webhook integration: enable switches, the webhook URL override,
 * bot identity, embed colors, mention content, and every template (see
 * `src/discordTemplate.js` for the {{TOKEN}} syntax those templates use).
 *
 * Gated by the same allowlist as `broadcast-test-notification` and
 * `admin-set-password`, via the shared `requireAdmin` — one list to audit.
 * The webhook URL itself is the only secret-shaped value here, and even that
 * is optional: leaving it unset falls back to the `DISCORD_WEBHOOK_URL` Edge
 * Function secret, which is what makes a GitHub Actions / Supabase secret the
 * primary way to configure this in practice (see .env.example).
 */
import { corsHeaders, json } from '../_shared/push.ts';
import { requireAdmin } from '../_shared/adminAuth.ts';
import { DEFAULT_DISCORD_SETTINGS, getDiscordSettings } from '../_shared/discord.ts';
import { hexToDiscordColor } from '../../../src/discordTemplate.js';

const TEXT_FIELDS = [
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

const BOOLEAN_FIELDS = ['enabled', 'bust_enabled', 'achievement_enabled', 'include_thumbnail'] as const;

const MAX_TEXT_LENGTH: Partial<Record<(typeof TEXT_FIELDS)[number], number>> = {
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

const DISCORD_WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/(\d+)\/([\w-]+)\/?$/;
const WEBHOOK_TOKEN_MASK = '••••••••••••••••';

function badRequest(message: string) {
  return json(400, { error: message });
}

/**
 * The webhook URL embeds a bearer-equivalent token: anyone who has it can
 * post to the channel. Never send the real token back to the browser — only
 * the (non-secret) numeric webhook id, with the token replaced by a fixed
 * placeholder. `settingsForClient` is what every response sends out.
 */
function maskWebhookUrl(url: string | null): string | null {
  if (!url) return null;
  const match = DISCORD_WEBHOOK_RE.exec(url);
  if (!match) return null;
  return `https://discord.com/api/webhooks/${match[2]}/${WEBHOOK_TOKEN_MASK}`;
}

function settingsForClient(settings: Record<string, unknown>) {
  return { ...settings, webhook_url: maskWebhookUrl((settings.webhook_url as string | null) ?? null) };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const gate = await requireAdmin(req, json);
    if (gate.denied) return gate.denied;
    const { admin, senderId, senderName } = gate.context;

    const body = await req.json().catch(() => ({}));
    const action = body?.action === 'update' ? 'update' : 'get';

    if (action === 'get') {
      const settings = await getDiscordSettings(admin);
      return json(200, { ok: true, settings: settingsForClient(settings), defaults: DEFAULT_DISCORD_SETTINGS });
    }

    const current = await getDiscordSettings(admin);
    const patch = body?.patch && typeof body.patch === 'object' ? body.patch : {};
    const update: Record<string, unknown> = {};

    for (const field of BOOLEAN_FIELDS) {
      if (field in patch) {
        if (typeof patch[field] !== 'boolean') return badRequest(`${field} must be a boolean`);
        update[field] = patch[field];
      }
    }

    for (const field of TEXT_FIELDS) {
      if (!(field in patch)) continue;
      const raw = patch[field];
      if (raw !== null && typeof raw !== 'string') return badRequest(`${field} must be a string or null`);
      const value = raw == null ? null : raw.trim() || null;

      // The client only ever sees the masked form of an existing webhook_url
      // (see `settingsForClient`). Submitting that unedited placeholder back
      // means "leave it alone" — not "set my secret to a string of bullets".
      if (field === 'webhook_url' && value && value === maskWebhookUrl(current.webhook_url)) continue;

      const limit = MAX_TEXT_LENGTH[field];
      if (value && limit && value.length > limit) return badRequest(`${field} is too long (max ${limit} characters)`);
      if (value && (field === 'bust_color' || field === 'achievement_color') && hexToDiscordColor(value) == null) {
        return badRequest(`${field} must be a hex color like #5865F2`);
      }
      if (value && field === 'webhook_url' && !DISCORD_WEBHOOK_RE.test(value)) {
        return badRequest('webhook_url must be a discord.com/api/webhooks/... URL');
      }
      update[field] = value;
    }

    if (!Object.keys(update).length) return badRequest('Nothing to update');

    update.updated_at = new Date().toISOString();
    update.updated_by = senderId;

    const { data, error } = await admin
      .from('discord_settings')
      .upsert({ id: 1, ...update }, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    console.log(`[admin-discord-settings] updated by ${senderName || senderId}:`, Object.keys(patch).join(', '));
    return json(200, { ok: true, settings: settingsForClient(data) });
  } catch (error) {
    console.error('[admin-discord-settings] failed', error);
    return json(500, { error: (error as Error).message || 'Discord settings update failed' });
  }
});
