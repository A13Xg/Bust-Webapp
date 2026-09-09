/*
 * broadcast-test-notification — debug-menu only.
 *
 * Pushes an arbitrary, admin-authored message to EVERY registered device,
 * including the sender's own. This is the one path in the app that can say
 * anything to everybody, so two things about it are deliberate:
 *
 *   1. An allowlist is the ONLY authorisation. `notify-event` can afford to let
 *      any authenticated caller in because it only ever announces a row that
 *      caller already owns; there is no equivalent ownership check available
 *      here, because the whole point is free text. Keep the list short. The
 *      check itself lives in _shared/adminAuth.ts, shared with
 *      admin-set-password so the two cannot drift apart.
 *   2. It does NOT go through the push_events ledger. The ledger exists to make
 *      a bust announce exactly once; a manual test send has no row behind it and
 *      is something you may legitimately want to repeat. (The ledger's `kind`
 *      column is also constrained to 'bust' | 'achievement'.)
 */
import { renderBroadcast } from '../../../src/broadcastTemplate.js';
import { corsHeaders, json, sendToSubscriptions, subscriptionsForCrew } from '../_shared/push.ts';
import { requireAdmin } from '../_shared/adminAuth.ts';

const TITLE_MAX = 120;
const BODY_MAX = 300;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const gate = await requireAdmin(req, json);
    if (gate.denied) return gate.denied;
    const { admin, senderName } = gate.context;

    const payload = await req.json().catch(() => ({}));
    const titleTemplate = String(payload?.title ?? '').slice(0, TITLE_MAX);
    const bodyTemplate = String(payload?.body ?? '').slice(0, BODY_MAX);
    const hasUserIds = Object.prototype.hasOwnProperty.call(payload || {}, 'userIds');
    let targetUserIds: string[] | null = null;
    if (hasUserIds && payload?.userIds !== null) {
      if (!Array.isArray(payload.userIds) || payload.userIds.some((id: unknown) => typeof id !== 'string' || !id.trim())) {
        return json(400, { error: 'userIds must be an array of non-empty user IDs' });
      }
      targetUserIds = [...new Set((payload.userIds as string[]).map(id => id.trim()))];
    }
    if (!titleTemplate.trim() && !bodyTemplate.trim()) {
      return json(400, { error: 'Expected a title or a body' });
    }

    const subscriptions = await subscriptionsForCrew(admin, null, targetUserIds); // null => everyone
    if (!subscriptions.length) return json(200, { ok: true, attempted: 0, delivered: 0, pruned: 0, crew: 0 });

    // One lookup for every recipient, so {{USER}} can name each of them.
    const recipientIds = [...new Set(subscriptions.map(row => row.user_id))];
    const { data: profiles } = await admin.from('profiles').select('id,username').in('id', recipientIds);
    const nameById = new Map((profiles || []).map(row => [row.id, row.username]));

    const sentAt = new Date();
    const context = { sender: senderName, crew: subscriptions.length, sentAt, timeZone: 'UTC' };
    const tag = `broadcast-${sentAt.getTime()}`;

    const result = await sendToSubscriptions(admin, subscriptions, subscription => {
      const ctx = { ...context, recipient: nameById.get(subscription.user_id) || null };
      return {
        title: renderBroadcast(titleTemplate, ctx),
        body: renderBroadcast(bodyTemplate, ctx),
        // A shared tag means a second test replaces the first on the device
        // instead of stacking up a pile of debug notifications.
        tag,
        kind: 'broadcast',
        data: { kind: 'broadcast', sourceId: tag },
      };
    });

    console.log('[broadcast] sent by', senderName, JSON.stringify(result));
    return json(200, { ok: true, crew: recipientIds.length, ...result });
  } catch (error) {
    console.error('[broadcast] failed', error);
    return json(500, { error: (error as Error).message || 'Broadcast failed' });
  }
});
