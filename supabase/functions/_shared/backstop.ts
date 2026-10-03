import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { announceAchievement, announceBust } from './announce.ts';
import { getDiscordSettings } from './discord.ts';
import { fetchAllPages } from '../../../src/fetchAllPages.js';

const MAX_EVENTS_PER_RUN = 50;

async function ledgerKeys(admin: SupabaseClient, table: string, ids: string[]) {
  const keys = new Set<string>();
  // Keep each IN filter short, and below PostgREST's row cap even if both
  // kinds happen to have the same source id.
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await admin
      .from(table)
      .select('kind,source_id')
      .in('source_id', ids.slice(offset, offset + 200));
    if (error) throw new Error(error.message);
    for (const row of data || []) keys.add(`${row.kind}:${row.source_id}`);
  }
  return keys;
}

/** Sweep both channels independently; a push claim says nothing about Discord. */
export async function dispatchRecentEvents(admin: SupabaseClient, since: string) {
  const [busts, achievements, settings] = await Promise.all([
    fetchAllPages((from, to) =>
      admin
        .from('busts')
        .select('id,user_id,note,city,timestamp')
        .gte('timestamp', since)
        // Stable ordering lets a bounded sweep work through the full page set.
        .order('timestamp', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllPages((from, to) =>
      admin
        .from('achievements')
        .select('id,user_id,achievement_type,unlocked_at')
        .gte('unlocked_at', since)
        .order('unlocked_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    getDiscordSettings(admin),
  ]);
  const ids = [...busts, ...achievements].map((row) => row.id);
  if (!ids.length) return { busts: 0, achievements: 0, delivered: 0, skipped: 0 };
  const [announced, discordAnnounced] = await Promise.all([
    ledgerKeys(admin, 'push_events', ids),
    settings.enabled ? ledgerKeys(admin, 'discord_events', ids) : Promise.resolve(new Set<string>()),
  ]);
  const summary = { busts: 0, achievements: 0, delivered: 0, skipped: 0 };

  let bustAttempts = 0;
  for (const bust of busts) {
    const pushHandled = announced.has(`bust:${bust.id}`);
    const discordHandled = !settings.enabled || !settings.bust_enabled || discordAnnounced.has(`bust:${bust.id}`);
    if (pushHandled && discordHandled) {
      summary.skipped += 1;
      continue;
    }
    if (bustAttempts++ >= MAX_EVENTS_PER_RUN) break;
    const outcome = await announceBust(admin, bust, undefined, { skipPush: pushHandled });
    if (outcome.status === 'sent') {
      summary.busts += 1;
      summary.delivered += outcome.result.delivered;
    } else {
      summary.skipped += 1;
    }
  }

  let achievementAttempts = 0;
  for (const achievement of achievements) {
    const pushHandled = announced.has(`achievement:${achievement.id}`);
    const discordHandled = !settings.enabled || !settings.achievement_enabled ||
      discordAnnounced.has(`achievement:${achievement.id}`);
    if (pushHandled && discordHandled) {
      summary.skipped += 1;
      continue;
    }
    if (achievementAttempts++ >= MAX_EVENTS_PER_RUN) break;
    const outcome = await announceAchievement(admin, achievement, undefined, { skipPush: pushHandled });
    if (outcome.status === 'sent') {
      summary.achievements += 1;
      summary.delivered += outcome.result.delivered;
    } else {
      summary.skipped += 1;
    }
  }

  return summary;
}
