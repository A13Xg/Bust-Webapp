/*
 * CI database connectivity check.
 *
 * Preferred CI mode uses DATABASE_URL against a disposable PostgreSQL service and
 * verifies the server schema after npm run db:migrate. If DATABASE_URL is not
 * present, the script falls back to a Supabase reachability/schema smoke check
 * using the public anon key used by the static GitHub Pages build.
 */
import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

async function checkPostgres() {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false });
  try {
    const ping = await pool.query('select 1 as ok');
    if (ping.rows[0]?.ok !== 1) throw new Error('select 1 returned an unexpected result');
    console.log('PASS  PostgreSQL connection');

    for (const table of ['users', 'busts', 'achievements']) {
      const { rows } = await pool.query('select to_regclass($1) as name', [`public.${table}`]);
      if (!rows[0]?.name) throw new Error(`missing table: public.${table}`);
      console.log(`PASS  Table "${table}" exists`);
    }
  } finally {
    await pool.end();
  }
}

async function checkSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('set DATABASE_URL for PostgreSQL CI checks, or VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for Supabase checks');
  }

  const base = SUPABASE_URL.replace(/\/$/, '');
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const auth = await fetch(`${base}/auth/v1/health`, { headers });
  if (!auth.ok) throw new Error(`Supabase Auth health failed (${auth.status})`);
  console.log('PASS  Supabase Auth service health');

  for (const table of ['profiles', 'busts', 'achievements']) {
    const res = await fetch(`${base}/rest/v1/${table}?select=id&limit=1`, { headers });
    const text = await res.text();
    if (/PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(text)) {
      throw new Error(`Supabase table "${table}" is missing: ${text.slice(0, 180)}`);
    }
    // 200 means selectable with current RLS. 401/403 can be expected when anon is
    // unauthenticated but still proves PostgREST found the relation before RLS.
    if (![200, 401, 403].includes(res.status)) {
      throw new Error(`Supabase table "${table}" returned unexpected status ${res.status}: ${text.slice(0, 180)}`);
    }
    console.log(`PASS  Supabase table "${table}" reachable (${res.status})`);
  }
}

try {
  if (DATABASE_URL) await checkPostgres();
  else await checkSupabase();
  console.log('\nDatabase connection OK.');
} catch (error) {
  console.error(`\nDB CHECK FAILED: ${error.message}`);
  process.exit(1);
}
