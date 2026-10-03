/*
 * dispatch-push-backstop — scheduled sweep for anything notify-event missed.
 *
 * The busting client normally announces its own bust the moment it lands. That
 * call can still be lost (tab closed mid-request, offline, an old build). This
 * runs on a schedule, finds recent busts/achievements with no push_events row,
 * and announces them. The ledger guarantees it never double-sends.
 *
 * The lookback window is deliberately short: a two-hour-old "someone busted"
 * notification is noise, not news.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { dispatchRecentEvents } from '../_shared/backstop.ts';
import { authorizeCron, corsHeaders, json } from '../_shared/push.ts';

const LOOKBACK_MS = 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase function environment is incomplete');
    if (!authorizeCron(req, serviceRoleKey)) return json(401, { error: 'Unauthorized' });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

    const summary = await dispatchRecentEvents(admin, since);

    // Housekeeping on the same schedule, because there is nowhere better for it
    // and it is a single indexed delete over a tiny table.
    //
    // Apple accepts pushes to an endpoint it has already invalidated — 201, not
    // 410 — so isGoneError never fires and bump_push_failure never records a
    // strike. Those rows would otherwise accumulate forever, inflating every
    // recipients/delivered count and multiplying each burst across a device's
    // ghost endpoints. Unacknowledged sends are the only evidence they are dead;
    // prune_dead_push_subscriptions is deliberately conservative about acting on
    // it (see the migration).
    const { data: prunedDead, error: pruneError } = await admin.rpc('prune_dead_push_subscriptions');
    if (pruneError) console.error('[dispatch-push-backstop] prune failed', pruneError.message);

    return json(200, { ok: true, ...summary, prunedDead: Number(prunedDead ?? 0) });
  } catch (error) {
    console.error('[dispatch-push-backstop]', error);
    return json(500, { error: error instanceof Error ? error.message : 'Backstop dispatch failed' });
  }
});
