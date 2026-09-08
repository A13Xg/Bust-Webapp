/*
 * dispatch-push-backstop — scheduled sweep for anything notify-event missed.
 *
 * The busting client normally announces its own bust the moment it lands. That
 * call can still be lost (tab closed mid-request, offline, an old build). This
 * runs on a schedule, finds recent busts/achievements with no push_events row,
 * and announces them. The ledger guarantees it never double-sends.
 *
 * The lookback window is deliberately short: a two-hour-old "someone busted"
 * notification is noise, not news.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { announceAchievement, announceBust } from '../_shared/announce.ts';
import { authorizeCron, corsHeaders, json } from '../_shared/push.ts';

const LOOKBACK_MS = 60 * 60 * 1000;
const MAX_EVENTS_PER_RUN = 50;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase function environment is incomplete');
    if (!authorizeCron(req, serviceRoleKey)) return json(401, { error: 'Unauthorized' });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

    const [bustsResult, achievementsResult, ledgerResult] = await Promise.all([
      admin
        .from('busts')
        .select('id,user_id,note,city,timestamp')
        .gte('timestamp', since)
        // Newest first: under a burst the budget must go to events that can still
        // be announced usefully, not to old ones that were already handled.
        .order('timestamp', { ascending: false })
        .limit(MAX_EVENTS_PER_RUN),
      admin
        .from('achievements')
        .select('id,user_id,achievement_type,unlocked_at')
        .gte('unlocked_at', since)
        .order('unlocked_at', { ascending: false })
        .limit(MAX_EVENTS_PER_RUN),
      admin.from('push_events').select('kind,source_id').gte('created_at', since),
    ]);
    if (bustsResult.error) throw new Error(bustsResult.error.message);
    if (achievementsResult.error) throw new Error(achievementsResult.error.message);
    if (ledgerResult.error) throw new Error(ledgerResult.error.message);

    const announced = new Set((ledgerResult.data || []).map(row => `${row.kind}:${row.source_id}`));
    const summary = { busts: 0, achievements: 0, delivered: 0, skipped: 0 };

    for (const bust of bustsResult.data || []) {
      if (announced.has(`bust:${bust.id}`)) {
        summary.skipped += 1;
        continue;
      }
      const outcome = await announceBust(admin, bust);
      if (outcome.status === 'sent') {
        summary.busts += 1;
        summary.delivered += outcome.result.delivered;
      } else {
        summary.skipped += 1;
      }
    }

    for (const achievement of achievementsResult.data || []) {
      if (announced.has(`achievement:${achievement.id}`)) {
        summary.skipped += 1;
        continue;
      }
      const outcome = await announceAchievement(admin, achievement);
      if (outcome.status === 'sent') {
        summary.achievements += 1;
        summary.delivered += outcome.result.delivered;
      } else {
        summary.skipped += 1;
      }
    }

    return json(200, { ok: true, ...summary });
  } catch (error) {
    console.error('[dispatch-push-backstop]', error);
    return json(500, { error: error instanceof Error ? error.message : 'Backstop dispatch failed' });
  }
});
