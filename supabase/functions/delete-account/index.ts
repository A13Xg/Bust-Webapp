/*
 * delete-account — removes the CALLER's own account, completely.
 *
 * Not an admin function: you can only ever delete yourself, so no allowlist.
 * The service-role key is required because deleting a row from `auth.users` is
 * not something a client key can do.
 *
 * Why this exists: the client used to delete only the `public.profiles` row.
 * The cascade runs the other way — `profiles.id references auth.users(id) on
 * delete cascade` — so the auth user survived, still holding the synthetic
 * email derived from the username. Signing up again with the same name then hit
 * Supabase Auth's duplicate-email check and surfaced as "Username already
 * exists", even though the profile really was gone. Deleting the auth user
 * instead cascades the profile away with it, and frees the name for reuse.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/push.ts';

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

    // The id comes from the verified token, never from the request body, so
    // there is no target to tamper with.
    const userId = authData.user.id;

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: profile } = await admin.from('profiles').select('username').eq('id', userId).maybeSingle();

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    console.log(`[delete-account] removed ${profile?.username || '(no profile)'} (${userId})`);
    return json(200, { ok: true });
  } catch (error) {
    console.error('[delete-account] failed', error);
    return json(500, { error: (error as Error).message || 'Account deletion failed' });
  }
});
