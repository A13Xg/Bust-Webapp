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
import {
  DEFAULT_DISCORD_SETTINGS,
  getDiscordSettings,
  maskDiscordSettings,
  maskWebhookUrl,
  validateDiscordSettingsPatch,
} from '../_shared/discord.ts';

function badRequest(message: string) {
  return json(400, { error: message });
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
      return json(200, { ok: true, settings: maskDiscordSettings(settings), defaults: DEFAULT_DISCORD_SETTINGS });
    }

    const current = await getDiscordSettings(admin);
    const patch = { ...(body?.patch && typeof body.patch === 'object' ? body.patch : {}) };

    // The client only ever sees the masked form of an existing webhook_url
    // (see `maskDiscordSettings`). Submitting that unedited placeholder back
    // means "leave it alone" — not "set my secret to a string of bullets" —
    // so drop it from the patch before validating/persisting anything.
    if (patch.webhook_url != null && patch.webhook_url === maskWebhookUrl(current.webhook_url)) {
      delete patch.webhook_url;
    }

    const validation = validateDiscordSettingsPatch(patch);
    if (!validation.ok) return badRequest(validation.error);
    const update: Record<string, unknown> = { ...validation.value };

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
    return json(200, { ok: true, settings: maskDiscordSettings(data) });
  } catch (error) {
    console.error('[admin-discord-settings] failed', error);
    return json(500, { error: (error as Error).message || 'Discord settings update failed' });
  }
});
