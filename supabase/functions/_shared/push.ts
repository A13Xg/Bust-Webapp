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
  { ttlSeconds = 60 * 60 * 12, actorId = null }: { ttlSeconds?: number; actorId?: string | null } = {}
): Promise<DeliveryResult> {
  configureVapid();
  const perSubscription = typeof payload === 'function' ? payload : null;
  // `?? {}` matters: without it a nullish payload would fall through the `??`
  // below into perSubscription!(sub) with perSubscription null. An empty object
  // is falsy-safe here because `??` only bridges null/undefined.
  const sharedPayload = perSubscription ? null : ((payload ?? {}) as PushPayload);
  const result: DeliveryResult = { attempted: subscriptions.length, delivered: 0, pruned: 0, failures: [] };
  const nowIso = new Date().toISOString();

  // Every delivery in this fan-out shares a batch id so the report can group
  // them back into one event; each carries its own receipt id, which is what the
  // service worker sends back to prove the notification actually arrived.
  const batchId = crypto.randomUUID();
  const ackUrl = `${Deno.env.get('SUPABASE_URL') || ''}/functions/v1/ack-push`;

  const outcomes = await Promise.all(
    subscriptions.map(async sub => {
      const receiptId = crypto.randomUUID();
      const base = sharedPayload ?? perSubscription!(sub);
      const body = JSON.stringify({ ...base, data: { ...(base.data || {}), receiptId, ackUrl } });
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          // "high" urgency keeps iOS from batching crew alerts into oblivion.
          { TTL: ttlSeconds, urgency: 'high' }
        );
        return { sub, ok: true as const, receiptId, title: base.title || '', kind: base.kind || 'push' };
      } catch (error) {
        return { sub, ok: false as const, error };
      }
    })
  );

  // Log what the push services accepted. Best-effort on purpose: this is
  // observability, and a missing table or a failed insert must never turn a
  // delivered notification into a failed dispatch.
  const accepted = outcomes.filter(outcome => outcome.ok);
  if (accepted.length) {
    const { error } = await admin.from('push_deliveries').insert(
      accepted.map(outcome => ({
        receipt_id: outcome.receiptId,
        batch_id: batchId,
        kind: outcome.kind,
        actor_id: actorId,
        recipient_id: outcome.sub.user_id,
        title: outcome.title,
        sent_at: nowIso,
      }))
    );
    if (error) console.error('[push] delivery log insert failed', error.message);
  }

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
export async function subscriptionsForCrew(
  admin: SupabaseClient,
  excludeUserId: string | null,
  targetUserIds: string[] | null = null
) {
  // Paginated: PostgREST caps an unranged select at 1000 rows, which would have
  // silently delivered to the first 1000 endpoints and reported that count as
  // if it were the whole crew.
  return (await fetchAllPages((from: number, to: number) => {
    let query = admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').range(from, to);
    if (excludeUserId) query = query.neq('user_id', excludeUserId);
    if (targetUserIds) query = targetUserIds.length ? query.in('user_id', targetUserIds) : query.in('user_id', ['']);
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
