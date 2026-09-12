/*
 * register-push-subscription — stores the caller's browser push endpoint.
 *
 * Called every time the app starts with notifications granted, not just when the
 * user first opts in, because browsers rotate and drop subscriptions silently.
 * Re-registering on every launch is what makes push survive the rotation that
 * otherwise ends delivery for good.
 *
 * Pass { sendTest: true } to have the server immediately push to the endpoint it
 * just stored. That exercises VAPID signing, the push service, and the service
 * worker in one round trip, so "did it actually work" has a real answer.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { reconcileInactivityReminderState } from '../../../src/inactivityReminder.js';
import { corsHeaders, json, sendToSubscriptions } from '../_shared/push.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = req.headers.get('Authorization');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Supabase function environment is incomplete');
    if (!authorization) return json(401, { error: 'Authentication required' });

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return json(401, { error: 'Authentication required' });

    const payload = await req.json().catch(() => ({}));
    const sub = payload?.subscription;
    const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
    const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
    const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : '';
    if (!endpoint || !p256dh || !auth) return json(400, { error: 'Invalid push subscription payload' });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const userId = authData.user.id;
    const userAgent = typeof payload?.userAgent === 'string' ? payload.userAgent.slice(0, 256) : null;
    const nowIso = new Date().toISOString();

    // An endpoint identifies one browser profile. If it previously belonged to a
    // different account (shared device, account switch), reclaim it atomically so
    // the unique index on (endpoint) cannot race between delete + upsert.
    //
    // failure_count is reset explicitly: this upsert UPDATEs the existing row
    // rather than replacing it, so without this a reclaimed (or previously
    // flaky) endpoint would inherit a stale count and sit near the prune
    // threshold. Having just completed pushManager.subscribe(), the endpoint is
    // demonstrably alive.
    const { error: upsertError } = await admin.from('push_subscriptions').upsert(
      [{ user_id: userId, endpoint, p256dh, auth, user_agent: userAgent, updated_at: nowIso, failure_count: 0 }],
      { onConflict: 'endpoint' }
    );
    if (upsertError) throw new Error(upsertError.message);

    // Keep the reminder cycle in sync so a newly armed device is not immediately
    // nagged (or skipped) because its schedule was never initialised.
    const [profileResult, reminderStateResult] = await Promise.all([
      // maybeSingle: an auth user with no profile row must still be able to arm push.
      admin.from('profiles').select('last_bust_timestamp').eq('id', userId).maybeSingle(),
      admin
        .from('inactivity_reminders')
        .select('cycle_bust_at,scheduled_for,last_sent_at,last_message_index')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (reminderStateResult.error) throw new Error(reminderStateResult.error.message);

    const reconciled = reconcileInactivityReminderState({
      latestBustAt: profileResult.data?.last_bust_timestamp || null,
      state: reminderStateResult.data
        ? {
            cycleBustAt: reminderStateResult.data.cycle_bust_at,
            scheduledFor: reminderStateResult.data.scheduled_for,
            lastSentAt: reminderStateResult.data.last_sent_at,
            lastMessageIndex: reminderStateResult.data.last_message_index,
          }
        : null,
    });

    if (reconciled) {
      const { error: stateError } = await admin.from('inactivity_reminders').upsert({
        user_id: userId,
        cycle_bust_at: reconciled.cycleBustAt,
        scheduled_for: reconciled.scheduledFor,
        last_sent_at: reconciled.lastSentAt,
        last_message_index: reconciled.lastMessageIndex,
        updated_at: nowIso,
      });
      if (stateError) throw new Error(stateError.message);
    }

    let test = null;
    if (payload?.sendTest === true) {
      const { data: stored, error: storedError } = await admin
        .from('push_subscriptions')
        .select('id,user_id,endpoint,p256dh,auth')
        .eq('endpoint', endpoint)
        .eq('user_id', userId);
      if (storedError) throw new Error(storedError.message);
      const result = await sendToSubscriptions(admin, stored || [], {
        title: 'BUST push is live',
        body: 'If you are reading this on your lock screen, everything downstream works.',
        tag: `bust-test-${userId}`,
        kind: 'test',
        data: { kind: 'test' },
      }, { actorId: userId });
      test = { delivered: result.delivered, attempted: result.attempted, pruned: result.pruned, failures: result.failures };
    }

    return json(200, { ok: true, endpoint, test });
  } catch (error) {
    console.error('[register-push-subscription]', error);
    return json(500, { error: error instanceof Error ? error.message : 'Push registration failed' });
  }
});
