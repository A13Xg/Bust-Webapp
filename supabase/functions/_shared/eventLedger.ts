/*
 * Generic "claim an event exactly once" ledger helper.
 *
 * Both `push_events` and `discord_events` are append-only tables with a
 * `unique(kind, source_id)` constraint — a row can only ever be inserted once
 * per (kind, source_id) pair, so "insert, and treat a unique-violation as
 * someone else already claimed it" is what makes concurrent callers (a direct
 * client call racing the cron backstop sweep) safe without any locking.
 *
 * This file only factors out that shared claim/release shape. Each ledger
 * keeps its own "finish" function (`finishPushEvent` / `finishDiscordEvent`)
 * since the two tables record different outcome columns (delivery counts for
 * push, an HTTP status/error for Discord) and forcing those into one generic
 * shape would obscure more than it would save.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type EventKind = 'bust' | 'achievement';

/**
 * Claim an event for dispatch. Returns the new row's id, or null when another
 * caller already claimed it (not an error — that's the whole point).
 */
export async function claimEvent(
  admin: SupabaseClient,
  table: string,
  kind: EventKind,
  sourceId: string,
  actorId: string | null
): Promise<number | null> {
  const { data, error } = await admin
    .from(table)
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
 * Without this, any error between claiming and sending silently and
 * permanently suppresses that notification.
 */
export async function releaseEvent(admin: SupabaseClient, table: string, eventId: number) {
  const { error } = await admin.from(table).delete().eq('id', eventId);
  if (error) console.error(`[${table}] could not release claim`, eventId, error.message);
}
