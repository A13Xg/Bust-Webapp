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
 */
import { corsHeaders, json } from '../_shared/push.ts';
import { requireAdmin } from '../_shared/adminAuth.ts';
import { getDiscordSettings, sendDiscordTestMessage } from '../_shared/discord.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const gate = await requireAdmin(req, json);
    if (gate.denied) return gate.denied;
    const { admin, senderName, senderId } = gate.context;

    const body = await req.json().catch(() => ({}));
    const kind = body?.kind === 'achievement' ? 'achievement' : 'bust';
    const overrides = body?.settings && typeof body.settings === 'object' ? body.settings : {};

    const saved = await getDiscordSettings(admin);
    const settings = { ...saved, ...overrides };

    const result = await sendDiscordTestMessage(kind, settings);
    console.log(`[discord-test-notification] ${kind} test sent by ${senderName || senderId}`);
    return json(200, { kind, ...result });
  } catch (error) {
    console.error('[discord-test-notification] failed', error);
    return json(500, { error: (error as Error).message || 'Discord test send failed' });
  }
});
