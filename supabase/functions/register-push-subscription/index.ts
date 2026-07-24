import { createClient } from 'npm:@supabase/supabase-js@2';
import { reconcileInactivityReminderState } from '../../../src/inactivityReminder.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

    const [upsertResult, profileResult, reminderStateResult] = await Promise.all([
      admin.from('push_subscriptions').upsert(
        [{ user_id: userId, endpoint, p256dh, auth, user_agent: userAgent }],
        { onConflict: 'user_id,endpoint' }
      ),
      admin.from('profiles').select('last_bust_timestamp').eq('id', userId).single(),
      admin
        .from('inactivity_reminders')
        .select('cycle_bust_at,scheduled_for,last_sent_at,last_message_index')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (upsertResult.error) throw new Error(upsertResult.error.message);
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
        updated_at: new Date().toISOString(),
      });
      if (stateError) throw new Error(stateError.message);
    }

    return json(200, { ok: true });
  } catch (error) {
    console.error('[register-push-subscription]', error);
    return json(500, { error: error instanceof Error ? error.message : 'Push registration failed' });
  }
});
