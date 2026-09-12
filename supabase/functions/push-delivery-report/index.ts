/*
 * push-delivery-report — the delivery log behind the debug menu's DELIVERY tab.
 *
 * Admin-gated through the same `requireAdmin` allowlist as the broadcast and
 * password endpoints. The log records which account received which notification,
 * which is not crew-wide readable information, so it does not get an RLS policy
 * that would let any signed-in user read it.
 *
 * Returns flat rows and lets the browser aggregate (src/pushDeliveryReport.js).
 * Aggregating here would mean the summary and the running log could disagree.
 */
import { requireAdmin } from '../_shared/adminAuth.ts';
import { corsHeaders, json } from '../_shared/push.ts';

// Enough to cover weeks of a crew this size in one request, and bounded so the
// tab cannot pull an unlimited table down a phone connection.
const MAX_ROWS = 1000;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const gate = await requireAdmin(req, json);
    if (gate.denied) return gate.denied;
    const { admin } = gate.context;

    const { data, error } = await admin
      .from('push_deliveries')
      .select('batch_id,kind,actor_id,recipient_id,title,sent_at,acked_at')
      .order('sent_at', { ascending: false })
      .limit(MAX_ROWS);
    // The log is best-effort telemetry written alongside each send. If the table
    // is missing (migration not yet applied) the tab should say "no deliveries",
    // not error — the rest of the debug menu still works.
    if (error) {
      console.error('[push-delivery-report] read failed', error.message);
      return json(200, { ok: true, deliveries: [], unavailable: error.message });
    }

    const rows = data || [];
    const ids = [...new Set(rows.flatMap(row => [row.actor_id, row.recipient_id]).filter(Boolean))] as string[];
    const nameById = new Map<string, string>();
    if (ids.length) {
      const { data: profiles } = await admin.from('profiles').select('id,username').in('id', ids);
      for (const profile of profiles || []) nameById.set(profile.id, profile.username);
    }

    return json(200, {
      ok: true,
      deliveries: rows.map(row => ({
        batchId: row.batch_id,
        kind: row.kind,
        title: row.title,
        sentAt: row.sent_at,
        ackedAt: row.acked_at,
        // A deleted account leaves its rows behind with a null actor.
        actorName: row.actor_id ? nameById.get(row.actor_id) || 'Unknown' : 'System',
        recipientName: row.recipient_id ? nameById.get(row.recipient_id) || 'Unknown' : 'Unknown',
      })),
    });
  } catch (error) {
    console.error('[push-delivery-report]', error);
    return json(500, { error: error instanceof Error ? error.message : 'Delivery report failed' });
  }
});
