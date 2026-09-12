/*
 * dispatch-inactivity-reminders — the 5-7 day "are you still alive" nag.
 *
 * Called on a schedule (see .github/workflows/notify-cron.yml). Each user's
 * next reminder is a random point inside a 5-7 day window measured from their
 * last bust, so the crew is never pinged in lockstep; a fresh bust resets the
 * cycle via the bust_reset_inactivity_reminder trigger.
 *
 * Scheduling maths lives in src/inactivityReminder.js and is shared verbatim
 * with the browser, so the server and the client agree on when a nag is due.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { fetchAllPages } from '../../../src/fetchAllPages.js';
import {
  isInactivityReminderDue,
  markInactivityReminderSent,
  pickInactivityReminderMessage,
  reconcileInactivityReminderState,
} from '../../../src/inactivityReminder.js';
import { authorizeCron, corsHeaders, json, sendToSubscriptions } from '../_shared/push.ts';

const BATCH_SIZE = 200;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase function environment is incomplete');
    if (!authorizeCron(req, serviceRoleKey)) return json(401, { error: 'Unauthorized' });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const now = Date.now();

    const profiles = await fetchAllPages(
      (from: number, to: number) =>
        admin
          .from('profiles')
          .select('id,last_bust_timestamp')
          .not('last_bust_timestamp', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      BATCH_SIZE
    );

    let sentCount = 0;
    let failedCount = 0;
    let scheduledCount = 0;
    let prunedSubscriptions = 0;

    for (let offset = 0; offset < profiles.length; offset += BATCH_SIZE) {
      const batch = profiles.slice(offset, offset + BATCH_SIZE);
      const userIds = batch.map((profile: { id: string }) => profile.id);
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
      const subscriptionsByUser = new Map<string, Array<{ id: number; user_id: string; endpoint: string; p256dh: string; auth: string }>>();
      for (const sub of subscriptionsResult.data || []) {
        if (!subscriptionsByUser.has(sub.user_id)) subscriptionsByUser.set(sub.user_id, []);
        subscriptionsByUser.get(sub.user_id)?.push(sub);
      }

      const upserts: Array<Record<string, unknown>> = [];

      for (const profile of batch) {
        const subscriptions = subscriptionsByUser.get(profile.id) || [];
        const reconciled = reconcileInactivityReminderState({
          state: stateByUser.get(profile.id) || null,
          latestBustAt: profile.last_bust_timestamp,
          now,
        });
        if (!reconciled) continue;

        let nextState = reconciled;
        // No subscription means nothing to deliver to; keep the schedule warm so
        // the user starts receiving nags as soon as they arm a device.
        if (subscriptions.length && isInactivityReminderDue(reconciled, profile.last_bust_timestamp, now)) {
          const chosen = pickInactivityReminderMessage({ lastMessageIndex: reconciled.lastMessageIndex });
          const result = await sendToSubscriptions(
            admin,
            subscriptions,
            {
              title: 'BUST is waiting',
              body: chosen.text,
              tag: `bust-inactivity-${profile.id}`,
              kind: 'inactivity',
              data: { kind: 'inactivity' },
            },
            // Outliving one dispatch interval is pointless for a nag. The
            // reminder is self-addressed, so the user is their own actor.
            { ttlSeconds: 6 * 60 * 60, actorId: profile.id }
          );
          prunedSubscriptions += result.pruned;
          // Advance the cycle on any attempt, delivered or not. Leaving a failed
          // reminder due meant it was retried on every run — every ten minutes —
          // until bump_push_failure evicted the subscription at 25 strikes, so a
          // transient push-service outage cost the user push entirely. Skipping
          // one nag is the cheaper failure.
          //
          // Advancing through markInactivityReminderSent is what keeps this
          // stable: it sets lastSentAt, so the next reconcile takes the
          // followup-window branch and leaves the new schedule alone. Writing a
          // bare retry timestamp into scheduledFor instead would be silently
          // rescheduled back to "now" whenever the slot sat late in its window.
          //
          // markInactivityReminderSent returns null for a state with no
          // cycle timestamp, which reconciled cannot be here — keep the
          // previous state rather than asserting that away.
          const advanced = markInactivityReminderSent(reconciled, {
            now,
            // A message nobody received must not burn its slot in the rotation.
            messageIndex: result.delivered > 0 ? chosen.index : reconciled.lastMessageIndex,
          });
          if (advanced) nextState = advanced;
          if (result.delivered > 0) sentCount += 1;
          else failedCount += 1;
        }

        upserts.push({
          user_id: profile.id,
          cycle_bust_at: nextState.cycleBustAt,
          scheduled_for: nextState.scheduledFor,
          last_sent_at: nextState.lastSentAt,
          last_message_index: nextState.lastMessageIndex,
          updated_at: new Date(now).toISOString(),
        });
      }

      if (upserts.length) {
        const { error: upsertError } = await admin.from('inactivity_reminders').upsert(upserts);
        if (upsertError) throw new Error(upsertError.message);
        scheduledCount += upserts.length;
      }
    }

    return json(200, {
      ok: true,
      sent: sentCount,
      undelivered: failedCount,
      usersScheduled: scheduledCount,
      staleSubscriptionsRemoved: prunedSubscriptions,
    });
  } catch (error) {
    console.error('[dispatch-inactivity-reminders]', error);
    return json(500, { error: error instanceof Error ? error.message : 'Dispatch failed' });
  }
});
