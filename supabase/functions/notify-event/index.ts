/*
 * notify-event — instant crew-wide push, called by the client that just acted.
 *
 * The caller may only announce their OWN row, and only while it is fresh, so a
 * user cannot spam the crew by replaying old ids. The push_events ledger makes
 * a retry (or a race with the cron backstop) a no-op rather than a duplicate.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { announceAchievement, announceBust } from '../_shared/announce.ts';
import { corsHeaders, json } from '../_shared/push.ts';

// A client that crashes mid-bust is covered by dispatch-push-backstop instead.
const MAX_EVENT_AGE_MS = 15 * 60 * 1000;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Supabase function environment is incomplete');

    const authorization = req.headers.get('Authorization');
    if (!authorization) return json(401, { error: 'Authentication required' });

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return json(401, { error: 'Authentication required' });
    const userId = authData.user.id;

    const payload = await req.json().catch(() => ({}));
    const kind = payload?.kind === 'achievement' ? 'achievement' : payload?.kind === 'bust' ? 'bust' : null;
    const id = typeof payload?.id === 'string' ? payload.id : '';
    if (!kind || !id) return json(400, { error: 'Expected { kind: "bust" | "achievement", id }' });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    if (kind === 'bust') {
      const { data, error } = await admin
        .from('busts')
        .select('id,user_id,note,city,timestamp')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return json(404, { error: 'Bust not found' });
      if (data.user_id !== userId) return json(403, { error: 'You can only announce your own bust' });
      if (Date.now() - new Date(data.timestamp).getTime() > MAX_EVENT_AGE_MS) {
        return json(200, { ok: true, status: 'stale' });
      }
      const outcome = await announceBust(admin, data);
      return json(200, { ok: true, ...outcome });
    }

    const { data, error } = await admin
      .from('achievements')
      .select('id,user_id,achievement_type,unlocked_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return json(404, { error: 'Achievement not found' });
    if (data.user_id !== userId) return json(403, { error: 'You can only announce your own achievement' });
    if (Date.now() - new Date(data.unlocked_at).getTime() > MAX_EVENT_AGE_MS) {
      return json(200, { ok: true, status: 'stale' });
    }
    const outcome = await announceAchievement(admin, data);
    return json(200, { ok: true, ...outcome });
  } catch (error) {
    console.error('[notify-event]', error);
    return json(500, { error: error instanceof Error ? error.message : 'Notification dispatch failed' });
  }
});
