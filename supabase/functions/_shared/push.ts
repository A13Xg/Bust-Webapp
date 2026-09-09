/*
 * Shared web-push delivery helpers for the BUST Edge Functions.
 *
 * Everything that actually puts a notification on someone's lock screen goes
 * through sendToSubscriptions() so the failure handling — pruning dead
 * endpoints, recording delivery health — is identical everywhere.
 */
import { fetchAllPages } from '../../../src/fetchAllPages.js';
import webpush from 'npm:web-push@3.6.7';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export type PushSubscriptionRow = {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  kind?: string;
  data?: Record<string, unknown>;
};

// Keyed on the public key rather than a boolean: a warm isolate that cached a
// boolean would keep signing with a rotated-away private key until it recycled.
let vapidConfiguredFor: string | null = null;

/** Throws with an actionable message when the VAPID pair is missing. */
export function configureVapid() {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set on this project');
  }
  if (vapidConfiguredFor === publicKey) return;
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@bust-ops.dev';
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfiguredFor = publicKey;
}

function statusCodeOf(error: unknown) {
  return Number((error as { statusCode?: number })?.statusCode) || 0;
}

/** 404/410 mean the endpoint is permanently gone and must be forgotten. */
export function isGoneError(error: unknown) {
  const code = statusCodeOf(error);
  return code === 404 || code === 410;
}

export type DeliveryResult = {
  attempted: number;
  delivered: number;
  pruned: number;
  failures: string[];
};

export async function sendToSubscriptions(
  admin: SupabaseClient,
  subscriptions: PushSubscriptionRow[],
  // A function instead of a payload renders per recipient, which is what lets a
  // broadcast address each person by their own name in one pass.
  payload: PushPayload | ((subscription: PushSubscriptionRow) => PushPayload),
  { ttlSeconds = 60 * 60 * 12 }: { ttlSeconds?: number } = {}
): Promise<DeliveryResult> {
  configureVapid();
  const perSubscription = typeof payload === 'function' ? payload : null;
  // `?? {}` matters: JSON.stringify(undefined) is undefined, which would fall
  // through the ?? below into perSubscription!(sub) with perSubscription null.
  const sharedBody = perSubscription ? null : JSON.stringify(payload ?? {});
  const result: DeliveryResult = { attempted: subscriptions.length, delivered: 0, pruned: 0, failures: [] };
  const nowIso = new Date().toISOString();

  const outcomes = await Promise.all(
    subscriptions.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          sharedBody ?? JSON.stringify(perSubscription!(sub)),
          // "high" urgency keeps iOS from batching crew alerts into oblivion.
          { TTL: ttlSeconds, urgency: 'high' }
        );
        return { sub, ok: true as const };
      } catch (error) {
        return { sub, ok: false as const, error };
      }
    })
  );

  const deliveredIds: number[] = [];
  const goneIds: number[] = [];
  const failedIds: number[] = [];
  for (const outcome of outcomes) {
    if (outcome.ok) {
      result.delivered += 1;
      deliveredIds.push(outcome.sub.id);
    } else if (isGoneError(outcome.error)) {
      goneIds.push(outcome.sub.id);
    } else {
      failedIds.push(outcome.sub.id);
      const message = (outcome.error as Error)?.message || String(outcome.error);
      result.failures.push(`${statusCodeOf(outcome.error) || '?'}: ${message.slice(0, 200)}`);
      console.error('[push] send failed', statusCodeOf(outcome.error), message);
    }
  }

  if (deliveredIds.length) {
    await admin
      .from('push_subscriptions')
      .update({ last_success_at: nowIso, failure_count: 0, updated_at: nowIso })
      .in('id', deliveredIds);
  }
  if (goneIds.length) {
    await admin.from('push_subscriptions').delete().in('id', goneIds);
    result.pruned += goneIds.length;
  }
  if (failedIds.length) {
    // A push service can reject for reasons that are not "gone" — most notably a
    // 403 when the subscription was created without our VAPID key. Those never
    // recover, so count them and let the database drop an endpoint that has
    // failed persistently. A transient 5xx is cleared by the next success.
    const { data: removed, error } = await admin.rpc('bump_push_failure', { subscription_ids: failedIds });
    if (error) {
      console.error('[push] failure bookkeeping failed', error.message);
    } else {
      result.pruned += Number(removed ?? 0);
    }
  }

  return result;
}

/** Every subscription belonging to anyone other than `excludeUserId`. */
export async function subscriptionsForCrew(admin: SupabaseClient, excludeUserId: string | null) {
  // Paginated: PostgREST caps an unranged select at 1000 rows, which would have
  // silently delivered to the first 1000 endpoints and reported that count as
  // if it were the whole crew.
  return (await fetchAllPages((from: number, to: number) => {
    let query = admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').range(from, to);
    if (excludeUserId) query = query.neq('user_id', excludeUserId);
    return query;
  })) as PushSubscriptionRow[];
}

/**
 * Claim an event for dispatch. Returns false when another caller already
 * claimed it, which is what makes the client fan-out and the cron backstop
 * safe to run concurrently.
 */
export async function claimPushEvent(
  admin: SupabaseClient,
  kind: 'bust' | 'achievement',
  sourceId: string,
  actorId: string | null
) {
  const { data, error } = await admin
    .from('push_events')
    .insert({ kind, source_id: sourceId, actor_id: actorId })
    .select('id')
    .maybeSingle();
  if (error) {
    // 23505 = someone else claimed it first. Any other error is real.
    if (error.code === '23505') return null;
    throw new Error(error.message);
  }
  return data?.id ?? null;
}

/**
 * Give a claim back after a failed dispatch, so the scheduled sweep can retry.
 * Without this, any error between claiming and sending silently and permanently
 * suppresses that notification.
 */
export async function releasePushEvent(admin: SupabaseClient, eventId: number) {
  const { error } = await admin.from('push_events').delete().eq('id', eventId);
  if (error) console.error('[push] could not release claim', eventId, error.message);
}

export async function finishPushEvent(
  admin: SupabaseClient,
  eventId: number,
  result: DeliveryResult
) {
  await admin
    .from('push_events')
    .update({ dispatched_at: new Date().toISOString(), recipients: result.attempted, delivered: result.delivered })
    .eq('id', eventId);
}

/**
 * Comparison whose running time does not depend on where the first differing
 * byte is, and which does not return early on a length mismatch (that would
 * leak the secret's length to a prober).
 */
export function secretsMatch(a: string | null, b: string | null) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (!left || !right) return false;
  let diff = left.length ^ right.length;
  const span = Math.max(left.length, right.length);
  for (let i = 0; i < span; i += 1) {
    diff |= left.charCodeAt(i % left.length) ^ right.charCodeAt(i % right.length);
  }
  return diff === 0;
}

/**
 * Authorize a scheduled invocation. Accepts either the shared cron secret or a
 * service-role bearer token, so rotating one never takes dispatch offline.
 */
export function authorizeCron(req: Request, serviceRoleKey: string) {
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET') || '';
  const header = req.headers.get('x-cron-secret');
  if (cronSecret && secretsMatch(header, cronSecret)) return true;
  const authHeader = req.headers.get('Authorization') || '';
  if (secretsMatch(authHeader, `Bearer ${serviceRoleKey}`)) return true;
  return false;
}
