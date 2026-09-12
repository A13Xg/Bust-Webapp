/*
 * ack-push — the device confirming a notification actually arrived.
 *
 * Web push has no delivery receipt. `webpush.sendNotification` resolving means a
 * push service accepted the message for onward delivery, nothing more, so
 * `push_subscriptions.last_success_at` systematically overstates reality. The
 * only party that knows a notification landed is the device that rendered it,
 * and the service worker is what calls this.
 *
 * Unauthenticated by necessity: a service worker has no access to the page's
 * Supabase session. The per-delivery `receipt_id` in the push payload IS the
 * authorisation — an unguessable UUID that grants exactly one capability, to
 * stamp one row's `acked_at`. Every response is 204 whether or not the id
 * existed, so the endpoint cannot be used to probe for valid receipts, and
 * `.is('acked_at', null)` makes a replay a no-op rather than moving the
 * timestamp.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/push.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const noContent = () => new Response(null, { status: 204, headers: corsHeaders });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase function environment is incomplete');

    const payload = await req.json().catch(() => ({}));
    const receiptId = typeof payload?.receiptId === 'string' ? payload.receiptId : '';
    // Shape-check before touching the database: an arbitrary string would make
    // Postgres raise a cast error on a uuid comparison, turning junk input into
    // a 500.
    if (!UUID_RE.test(receiptId)) return noContent();

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { error } = await admin
      .from('push_deliveries')
      .update({ acked_at: new Date().toISOString() })
      .eq('receipt_id', receiptId)
      .is('acked_at', null);
    if (error) console.error('[ack-push] update failed', error.message);

    return noContent();
  } catch (error) {
    console.error('[ack-push]', error);
    // Still 204. An acknowledgement is telemetry; a service worker has nothing
    // useful to do with an error, and retrying would only amplify the problem.
    return noContent();
  }
});
