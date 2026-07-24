import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { fetchAllPages } from '../../../src/fetchAllPages.js';
import {
  isInactivityReminderDue,
  markInactivityReminderSent,
  pickInactivityReminderMessage,
  reconcileInactivityReminderState,
} from '../../../src/inactivityReminder.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};
const BATCH_SIZE = 200;

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isGoneError(error: unknown) {
  const statusCode = Number((error as { statusCode?: number })?.statusCode);
  return statusCode === 404 || statusCode === 410;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!supabaseUrl || !serviceRoleKey || !vapidPublic || !vapidPrivate) {
      throw new Error('Supabase function environment is incomplete');
    }

    const cronSecret = Deno.env.get('REMINDER_CRON_SECRET');
    const authHeader = req.headers.get('Authorization');
    const cronHeader = req.headers.get('x-cron-secret');
    const serviceBearer = ['Bearer', serviceRoleKey].join(' ');
    if ((cronSecret && cronHeader !== cronSecret) || (!cronSecret && authHeader !== serviceBearer)) {
      return json(401, { error: 'Unauthorized' });
    }

    webpush.setVapidDetails('mailto:noreply@bust.local', vapidPublic, vapidPrivate);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const now = Date.now();
    const profiles = await fetchAllPages((from, to) =>
      admin
        .from('profiles')
        .select('id,last_bust_timestamp')
        .not('last_bust_timestamp', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
      BATCH_SIZE
    );

    let sentCount = 0;
    let scheduledCount = 0;
    let removedSubscriptions = 0;

    for (let offset = 0; offset < profiles.length; offset += BATCH_SIZE) {
      const batch = profiles.slice(offset, offset + BATCH_SIZE);
      const userIds = batch.map(profile => profile.id);
      if (!userIds.length) continue;

      const [statesResult, subscriptionsResult] = await Promise.all([
        admin
          .from('inactivity_reminders')
          .select('user_id,cycle_bust_at,scheduled_for,last_sent_at,last_message_index')
          .in('user_id', userIds),
        admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', userIds),
      ]);
      if (statesResult.error) throw new Error(statesResult.error.message);
      if (subscriptionsResult.error) throw new Error(subscriptionsResult.error.message);

      const stateByUser = new Map(
        (statesResult.data || []).map(state => [
          state.user_id,
          {
            cycleBustAt: state.cycle_bust_at,
            scheduledFor: state.scheduled_for,
            lastSentAt: state.last_sent_at,
            lastMessageIndex: state.last_message_index,
          },
        ])
      );
      const subscriptionsByUser = new Map<string, Array<{ id: number; endpoint: string; p256dh: string; auth: string }>>();
      for (const sub of subscriptionsResult.data || []) {
        if (!subscriptionsByUser.has(sub.user_id)) subscriptionsByUser.set(sub.user_id, []);
        subscriptionsByUser.get(sub.user_id)?.push(sub);
      }

      for (const profile of batch) {
        const subscriptions = subscriptionsByUser.get(profile.id) || [];
        if (!subscriptions.length) continue;
        const reconciled = reconcileInactivityReminderState({
          state: stateByUser.get(profile.id) || null,
          latestBustAt: profile.last_bust_timestamp,
          now,
        });
        if (!reconciled) continue;

        let nextState = reconciled;
        if (isInactivityReminderDue(reconciled, profile.last_bust_timestamp, now)) {
          const chosen = pickInactivityReminderMessage({ lastMessageIndex: reconciled.lastMessageIndex });
          const payload = JSON.stringify({
            title: 'BUST Inactivity Reminder',
            body: chosen.text,
            tag: `bust-inactivity-${profile.id}`,
            data: { type: 'inactivity-reminder' },
          });
          let delivered = false;
          for (const sub of subscriptions) {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload,
                { TTL: 60 * 60 }
              );
              delivered = true;
            } catch (error) {
              if (isGoneError(error)) {
                await admin.from('push_subscriptions').delete().eq('id', sub.id);
                removedSubscriptions += 1;
              } else {
                console.error('[dispatch-inactivity-reminders] send failed', error);
              }
            }
          }
          if (delivered) {
            nextState = markInactivityReminderSent(reconciled, { now, messageIndex: chosen.index });
            sentCount += 1;
          }
        }

        const { error: upsertError } = await admin.from('inactivity_reminders').upsert({
          user_id: profile.id,
          cycle_bust_at: nextState.cycleBustAt,
          scheduled_for: nextState.scheduledFor,
          last_sent_at: nextState.lastSentAt,
          last_message_index: nextState.lastMessageIndex,
          updated_at: new Date(now).toISOString(),
        });
        if (upsertError) throw new Error(upsertError.message);
        scheduledCount += 1;
      }
    }

    return json(200, { ok: true, sent: sentCount, usersScheduled: scheduledCount, staleSubscriptionsRemoved: removedSubscriptions });
  } catch (error) {
    console.error('[dispatch-inactivity-reminders]', error);
    return json(500, { error: error instanceof Error ? error.message : 'Dispatch failed' });
  }
});
