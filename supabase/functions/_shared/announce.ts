/*
 * Turns a bust or achievement row into a crew-wide push AND a Discord webhook
 * message, exactly once each.
 *
 * Both callers share this: `notify-event` (the busting client, for instant
 * delivery) and `dispatch-push-backstop` (the scheduled sweep, for when that
 * client never made the call). The push_events ledger is what keeps them from
 * double-announcing the same row for push; `discord_events` (see
 * `_shared/discord.ts`) does the same job for Discord, independently, since
 * Discord delivery is not subject to push's cooldown/slot pacing.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { achievements } from '../../../src/rules.js';
import { buildAchievementNotification, buildBustNotification } from '../../../src/notificationMessages.js';
import { achievementSlotId } from '../../../src/pushCooldown.js';
import { sendDiscordNotification } from './discord.ts';
import {
  claimPushEvent,
  finishPushEvent,
  releasePushEvent,
  sendToSubscriptions,
  subscriptionsForCrew,
  type DeliveryResult,
} from './push.ts';

const achievementById = new Map(achievements.map((item: { id: string }) => [item.id, item]));

export type AnnounceOutcome =
  | { status: 'sent'; kind: string; sourceId: string; result: DeliveryResult }
  | { status: 'duplicate' | 'no-recipients' | 'unknown' | 'failed' | 'suppressed'; kind: string; sourceId: string };

/**
 * Record a row as handled without pushing anything. The claim is the point: an
 * unclaimed row stays visible to dispatch-push-backstop, which would re-evaluate
 * it on every run for its whole lookback window and announce it the moment the
 * cooldown lapsed — turning the cap into a delay.
 */
async function claimWithoutSending(
  admin: SupabaseClient,
  kind: 'bust' | 'achievement',
  sourceId: string,
  actorId: string
) {
  const eventId = await claimPushEvent(admin, kind, sourceId, actorId);
  if (eventId != null) {
    await finishPushEvent(admin, eventId, { attempted: 0, delivered: 0, pruned: 0, failures: [] });
  }
}

/*
 * One reconcile writes every newly earned achievement in a single upsert, so a
 * burst shares one `unlocked_at` to within the round trip. Two minutes is far
 * wider than that and still far narrower than the backstop's one-hour lookback.
 */
const BURST_WINDOW_MS = 2 * 60 * 1000;

/**
 * Retire the rows a bust unlocked but did not announce.
 *
 * Without this the cap is a delay, not a cap. The client picks one unlock to
 * announce and simply drops the rest — but those rows are still sitting in
 * `achievements` inside dispatch-push-backstop's lookback with no `push_events`
 * row, so the next sweep treats one of them as un-announced and pushes it. The
 * ten-minute cooldown slot does not stop that: the slot the client used has
 * already expired by the time the sweep runs, so the sweep claims a fresh one.
 * Net effect was two achievement pushes per bust, ten minutes apart.
 *
 * Claiming them with zero recipients records them as handled, which is the only
 * thing the sweep checks.
 */
async function retireUnannouncedSiblings(
  admin: SupabaseClient,
  actorId: string,
  anchorUnlockedAt: string | null | undefined,
  announcedId: string
) {
  const anchor = anchorUnlockedAt ? new Date(anchorUnlockedAt).getTime() : Date.now();
  if (!Number.isFinite(anchor)) return;
  const { data, error } = await admin
    .from('achievements')
    .select('id')
    .eq('user_id', actorId)
    .gte('unlocked_at', new Date(anchor - BURST_WINDOW_MS).toISOString())
    .lte('unlocked_at', new Date(anchor + BURST_WINDOW_MS).toISOString());
  if (error) {
    // Best-effort: the worst case is the pre-existing behaviour, one extra push.
    console.error('[announce] could not retire siblings', error.message);
    return;
  }
  for (const row of data || []) {
    if (row.id === announcedId) continue;
    await claimWithoutSending(admin, 'achievement', row.id, actorId);
  }
}

async function usernameFor(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from('profiles').select('username').eq('id', userId).maybeSingle();
  return data?.username || 'Someone';
}

async function announce(
  admin: SupabaseClient,
  kind: 'bust' | 'achievement',
  sourceId: string,
  actorId: string,
  payload: { title: string; body: string; tag: string; kind: string },
  // A cooldown slot held on the caller's behalf. Released alongside the row's own
  // claim if the send fails, so one transient failure does not burn the whole
  // window and lock the backstop out of retrying.
  slotEventId: number | null = null
): Promise<AnnounceOutcome> {
  const eventId = await claimPushEvent(admin, kind, sourceId, actorId);
  if (eventId == null) {
    if (slotEventId != null) await releasePushEvent(admin, slotEventId);
    return { status: 'duplicate', kind, sourceId };
  }

  try {
    const subscriptions = await subscriptionsForCrew(admin, actorId);
    if (!subscriptions.length) {
      await finishPushEvent(admin, eventId, { attempted: 0, delivered: 0, pruned: 0, failures: [] });
      return { status: 'no-recipients', kind, sourceId };
    }

    const result = await sendToSubscriptions(
      admin,
      subscriptions,
      { ...payload, data: { kind, sourceId } },
      { actorId }
    );
    // sendToSubscriptions returns individual transport failures rather than
    // throwing. Keep an all-failed attempt retryable without duplicating a
    // partially successful send to devices that already received it.
    if (result.delivered === 0 && result.failures.length > 0) {
      throw new Error('No push service accepted the notification');
    }
    await finishPushEvent(admin, eventId, result);
    return { status: 'sent', kind, sourceId, result };
  } catch (error) {
    // The claim is what stops a second caller announcing the same row. Holding
    // it after a failed send would suppress the notification permanently — the
    // backstop would see the row and skip it forever. Release it so the sweep
    // can retry, and let the caller see the failure.
    await releasePushEvent(admin, eventId);
    if (slotEventId != null) await releasePushEvent(admin, slotEventId);
    console.error('[announce] release after failure', kind, sourceId, error);
    return { status: 'failed', kind, sourceId };
  }
}

export async function announceBust(
  admin: SupabaseClient,
  bust: { id: string; user_id: string; note?: string | null; city?: string | null; timestamp?: string },
  username?: string,
  { skipPush = false } = {}
) {
  const name = username || (await usernameFor(admin, bust.user_id));
  const payload = buildBustNotification({
    username: name,
    note: bust.note,
    bustId: bust.id,
    city: bust.city,
  });
  // Independent of the push outcome above (sent, no-recipients, duplicate —
  // all mean "this bust happened"): Discord gets its own exactly-once ledger,
  // see _shared/discord.ts. Run alongside the push send rather than after it —
  // sendDiscordNotification never throws, so there's no error-handling reason
  // to serialize them, and doing so would add the full webhook round trip to
  // every bust's latency for no benefit.
  const [outcome] = await Promise.all([
    skipPush
      ? Promise.resolve({ status: 'duplicate' as const, kind: 'bust', sourceId: bust.id })
      : announce(admin, 'bust', bust.id, bust.user_id, payload),
    sendDiscordNotification(admin, 'bust', {
      sourceId: bust.id,
      actorId: bust.user_id,
      username: name,
      note: bust.note,
      city: bust.city,
      occurredAt: bust.timestamp,
      pushTitle: payload.title,
      pushBody: payload.body,
    }),
  ]);
  return outcome;
}

export async function announceAchievement(
  admin: SupabaseClient,
  achievement: { id: string; user_id: string; achievement_type: string; unlocked_at?: string | null },
  username?: string,
  { skipPush = false } = {}
) {
  const meta = achievementById.get(achievement.achievement_type) as
    { name?: string; tier?: string; points?: number; accent?: string } | undefined;
  // An id outside the catalog means stale or hand-written data. Claim it anyway
  // so the scheduled sweep evaluates it once rather than on every run for the
  // whole lookback window, then decline to announce it (nothing meaningful to
  // show on Discord either, since there is no catalog name/tier to display).
  if (!meta) {
    await claimWithoutSending(admin, 'achievement', achievement.id, achievement.user_id);
    return { status: 'unknown' as const, kind: 'achievement', sourceId: achievement.id };
  }

  const name = username || (await usernameFor(admin, achievement.user_id));
  const payload = buildAchievementNotification({
    username: name,
    achievementName: meta.name,
    achievementId: achievement.achievement_type,
    tier: meta.tier,
  });
  const discordContext = {
    sourceId: achievement.id,
    actorId: achievement.user_id,
    username: name,
    achievementName: meta.name,
    tier: meta.tier,
    points: meta.points,
    accent: meta.accent,
    occurredAt: achievement.unlocked_at,
    pushTitle: payload.title,
    pushBody: payload.body,
  };

  // A Discord-only retry must not reserve a fresh push cooldown slot or
  // resurrect a sibling that was deliberately suppressed on mobile.
  if (skipPush) {
    await sendDiscordNotification(admin, 'achievement', discordContext);
    return { status: 'duplicate' as const, kind: 'achievement', sourceId: achievement.id };
  }

  // One achievement PUSH per actor per cooldown window — a lock-screen pacing
  // rule that has nothing to do with Discord, so a suppressed slot still gets
  // its own Discord message below. Claiming the slot is what makes the push
  // side safe under concurrency: the client fires its announcements in
  // parallel, so a read-then-check would let a whole burst through. The
  // unique index on (kind, source_id) arbitrates instead.
  const slotEventId = await claimPushEvent(
    admin,
    'achievement',
    achievementSlotId(achievement.user_id, Date.now()),
    achievement.user_id
  );
  if (slotEventId == null) {
    await Promise.all([
      claimWithoutSending(admin, 'achievement', achievement.id, achievement.user_id),
      sendDiscordNotification(admin, 'achievement', discordContext),
    ]);
    return { status: 'suppressed' as const, kind: 'achievement', sourceId: achievement.id };
  }
  await finishPushEvent(admin, slotEventId, { attempted: 0, delivered: 0, pruned: 0, failures: [] });

  // Same reasoning as announceBust: these two are independent and
  // sendDiscordNotification never throws, so run them concurrently instead of
  // adding the Discord round trip to every achievement's latency.
  const [outcome] = await Promise.all([
    announce(admin, 'achievement', achievement.id, achievement.user_id, payload, slotEventId),
    sendDiscordNotification(admin, 'achievement', discordContext),
  ]);

  // Only after a send actually went out. On 'failed' the claim was released so
  // the sweep can retry this row, and retiring its siblings then would throw
  // away the backlog the retry is meant to cover.
  if (outcome.status === 'sent') {
    await retireUnannouncedSiblings(admin, achievement.user_id, achievement.unlocked_at, achievement.id);
  }
  return outcome;
}
