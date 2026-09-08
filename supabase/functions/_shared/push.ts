/*
 * Shared web-push delivery helpers for the BUST Edge Functions.
 *
 * Everything that actually puts a notification on someone's lock screen goes
 * through sendToSubscriptions() so the failure handling — pruning dead
 * endpoints, recording delivery health — is identical everywhere.
 */
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

let vapidConfigured = false;

/** Throws with an actionable message when the VAPID pair is missing. */
export function configureVapid() {
  if (vapidConfigured) return;
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set on this project');
  }
  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@bust-ops.dev';
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
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
  payload: PushPayload,
  { ttlSeconds = 60 * 60 * 12 }: { ttlSeconds?: number } = {}
): Promise<DeliveryResult> {
  configureVapid();
  const body = JSON.stringify(payload);
  const result: DeliveryResult = { attempted: subscriptions.length, delivered: 0, pruned: 0, failures: [] };
  const nowIso = new Date().toISOString();

  const outcomes = await Promise.all(
    subscriptions.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
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
    result.pruned = goneIds.length;
  }
  if (failedIds.length) {
    // Best-effort health counter; a transient 500 from a push service is normal.
    await admin.from('push_subscriptions').update({ updated_at: nowIso }).in('id', failedIds);
  }

  return result;
}

/** Every subscription belonging to anyone other than `excludeUserId`. */
export async function subscriptionsForCrew(admin: SupabaseClient, excludeUserId: string | null) {
  let query = admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth');
  if (excludeUserId) query = query.neq('user_id', excludeUserId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as PushSubscriptionRow[];
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

/** Constant-time-ish comparison so a wrong cron secret cannot be probed byte by byte. */
export function secretsMatch(a: string | null, b: string | null) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
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
