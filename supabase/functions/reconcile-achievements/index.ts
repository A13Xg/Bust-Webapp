import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeAchievementUnlocks } from '../../../src/rules.js';
import { fetchAllPages } from '../../../src/fetchAllPages.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = req.headers.get('Authorization');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Supabase function environment is incomplete');
    if (!authorization) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const userId = authData.user.id;

    const [profileResult, busts, existing, profiles] = await Promise.all([
      admin.from('profiles').select('id, created_at').eq('id', userId).single(),
      fetchAllPages((from, to) => admin.from('busts').select('*').order('timestamp', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => admin.from('achievements').select('*').order('unlocked_at', { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => admin.from('profiles').select('id').order('created_at', { ascending: true }).range(from, to)),
    ]);

    if (profileResult.error || !profileResult.data) throw new Error(profileResult.error?.message || 'Profile not found');

    const earned = computeAchievementUnlocks(userId, busts, existing, {
      createdAt: profileResult.data.created_at,
      userCount: profiles.length,
    });

    if (earned.length) {
      const { error } = await admin.from('achievements').upsert(
        earned.map(achievement_type => ({ user_id: userId, achievement_type })),
        { onConflict: 'user_id,achievement_type', ignoreDuplicates: true }
      );
      if (error) throw new Error(error.message);
    }

    const achievements = await fetchAllPages((from, to) =>
      admin.from('achievements').select('*').order('unlocked_at', { ascending: false }).range(from, to)
    );

    return new Response(JSON.stringify({ achievements }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[reconcile-achievements]', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Reconciliation failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
