/*
 * Turns a bust or achievement row into a crew-wide push, exactly once.
 *
 * Both callers share this: `notify-event` (the busting client, for instant
 * delivery) and `dispatch-push-backstop` (the scheduled sweep, for when that
 * client never made the call). The push_events ledger is what keeps them from
 * double-announcing the same row.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { achievements } from '../../../src/rules.js';
import { buildAchievementNotification, buildBustNotification } from '../../../src/notificationMessages.js';
import {
  claimPushEvent,
  finishPushEvent,
  sendToSubscriptions,
  subscriptionsForCrew,
  type DeliveryResult,
} from './push.ts';

const achievementById = new Map(achievements.map((item: { id: string }) => [item.id, item]));

export type AnnounceOutcome =
  | { status: 'sent'; kind: string; sourceId: string; result: DeliveryResult }
  | { status: 'duplicate' | 'no-recipients'; kind: string; sourceId: string };

async function usernameFor(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from('profiles').select('username').eq('id', userId).maybeSingle();
  return data?.username || 'Someone';
}

async function announce(
  admin: SupabaseClient,
  kind: 'bust' | 'achievement',
  sourceId: string,
  actorId: string,
  payload: { title: string; body: string; tag: string; kind: string }
): Promise<AnnounceOutcome> {
  const eventId = await claimPushEvent(admin, kind, sourceId, actorId);
  if (eventId == null) return { status: 'duplicate', kind, sourceId };

  const subscriptions = await subscriptionsForCrew(admin, actorId);
  if (!subscriptions.length) {
    await finishPushEvent(admin, eventId, { attempted: 0, delivered: 0, pruned: 0, failures: [] });
    return { status: 'no-recipients', kind, sourceId };
  }

  const result = await sendToSubscriptions(admin, subscriptions, { ...payload, data: { kind, sourceId } });
  await finishPushEvent(admin, eventId, result);
  return { status: 'sent', kind, sourceId, result };
}

export async function announceBust(
  admin: SupabaseClient,
  bust: { id: string; user_id: string; note?: string | null; city?: string | null },
  username?: string
) {
  const name = username || (await usernameFor(admin, bust.user_id));
  const payload = buildBustNotification({
    username: name,
    note: bust.note,
    bustId: bust.id,
    city: bust.city,
  });
  return announce(admin, 'bust', bust.id, bust.user_id, payload);
}

export async function announceAchievement(
  admin: SupabaseClient,
  achievement: { id: string; user_id: string; achievement_type: string },
  username?: string
) {
  const meta = achievementById.get(achievement.achievement_type) as
    | { name?: string; tier?: string }
    | undefined;
  // Only announce catalog achievements; an unknown id means stale client data.
  if (!meta) return { status: 'duplicate' as const, kind: 'achievement', sourceId: achievement.id };
  const name = username || (await usernameFor(admin, achievement.user_id));
  const payload = buildAchievementNotification({
    username: name,
    achievementName: meta.name,
    achievementId: achievement.achievement_type,
    tier: meta.tier,
  });
  return announce(admin, 'achievement', achievement.id, achievement.user_id, payload);
}
