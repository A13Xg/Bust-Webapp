/*
 * discord-test-notification — debug-menu only.
 *
 * Sends one sample bust or achievement embed to the configured webhook so an
 * admin can see exactly what the real thing will look like before relying on
 * it. Gated by the same allowlist as every other admin function.
 *
 * Accepts an optional `settings` override in the body so an admin can preview
 * unsaved template/color/mention changes without writing them to the database
 * first — `admin-discord-settings` is the endpoint that actually persists them.
 * The override patch goes through the same `validateDiscordSettingsPatch` as
 * that endpoint, so an admin session can't smuggle an oversized template or a
 * malformed webhook URL into a live webhook call just because this path
 * doesn't persist anything.
 */
import { corsHeaders, json } from '../_shared/push.ts';
import { requireAdmin } from '../_shared/adminAuth.ts';
import {
  getDiscordSettings,
  maskWebhookUrl,
  sendDiscordTestMessage,
  validateDiscordSettingsPatch,
} from '../_shared/discord.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const gate = await requireAdmin(req, json);
    if (gate.denied) return gate.denied;
    const { admin, senderName, senderId } = gate.context;

    const body = await req.json().catch(() => ({}));
    const kind = body?.kind === 'achievement' ? 'achievement' : 'bust';
    const rawOverrides = { ...(body?.settings && typeof body.settings === 'object' ? body.settings : {}) };

    const saved = await getDiscordSettings(admin);

    // Same "unedited masked placeholder means no change" rule as
    // admin-discord-settings: the preview form loads the masked webhook_url,
    // and if the admin didn't touch it we must not send that placeholder to
    // Discord as if it were a real URL.
    if (rawOverrides.webhook_url != null && rawOverrides.webhook_url === maskWebhookUrl(saved.webhook_url)) {
      delete rawOverrides.webhook_url;
    }

    const validation = validateDiscordSettingsPatch(rawOverrides);
    if (!validation.ok) return json(400, { error: validation.error });

    const settings = { ...saved, ...validation.value };

    const result = await sendDiscordTestMessage(kind, settings);
    console.log(`[discord-test-notification] ${kind} test sent by ${senderName || senderId}`);
    return json(200, { kind, ...result });
  } catch (error) {
    console.error('[discord-test-notification] failed', error);
    return json(500, { error: (error as Error).message || 'Discord test send failed' });
  }
});
