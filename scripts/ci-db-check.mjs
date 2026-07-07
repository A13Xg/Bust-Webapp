/*
 * CI database connectivity check.
 * Verifies (using only the public anon key — no service credentials in CI):
 *   1. The Supabase Auth service is reachable and healthy.
 *   2. The anon key is accepted.
 *   3. The app schema exists (profiles/busts/achievements respond under RLS).
 * Exits non-zero with a clear message on any failure so the workflow goes red.
 */
const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!URL_ || !KEY) {
  console.error('DB CHECK FAILED: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set.');
  console.error('Add them under repo Settings → Secrets and variables → Actions → Secrets.');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
let failed = false;

async function check(name, path, ok) {
  try {
    const res = await fetch(`${URL_}${path}`, { headers });
    const pass = await ok(res);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} (${res.status})`);
    if (!pass) failed = true;
  } catch (e) {
    console.log(`FAIL  ${name} — ${e.message}`);
    failed = true;
  }
}

await check('Auth service health', '/auth/v1/health', r => r.ok);
// RLS hides rows from anon, but a valid schema returns 200 []; a missing table returns an error body.
for (const table of ['profiles', 'busts', 'achievements']) {
  await check(`Table "${table}" exists`, `/rest/v1/${table}?select=id&limit=1`, async r => {
    if (!r.ok) { console.log('      ', (await r.text()).slice(0, 140)); return false; }
    return true;
  });
}

if (failed) {
  console.error('\nDatabase check failed — is supabase/setup.sql applied and the project unpaused?');
  process.exit(1);
}
console.log('\nDatabase connection OK.');
