/*
 * admin-set-password — debug-menu only.
 *
 * Sets another user's password outright, with no knowledge of their old one.
 * Read that sentence again before changing anything here: this is the most
 * powerful endpoint in the project. Whoever can call it can take over any
 * account, which is strictly more than `broadcast-test-notification` can do.
 *
 * It is gated by the same allowlist, deliberately — one list to audit rather
 * than two — via the shared `requireAdmin`, so the check cannot drift between
 * the two functions.
 *
 * The service-role key is what makes `auth.admin.updateUserById` possible, and
 * it never leaves the function; the browser only ever sends a target id and a
 * new password over an authenticated call.
 */
import { corsHeaders, json } from '../_shared/push.ts';
import { requireAdmin } from '../_shared/adminAuth.ts';

const PASSWORD_MIN = 6;
const PASSWORD_MAX = 200;

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const gate = await requireAdmin(req, json);
    if (gate.denied) return gate.denied;
    const { admin, senderId, senderName } = gate.context;

    const payload = await req.json().catch(() => ({}));
    const targetId = typeof payload?.userId === 'string' ? payload.userId.trim() : '';
    const password = typeof payload?.password === 'string' ? payload.password : '';

    if (!targetId) return json(400, { error: 'Expected a userId' });
    if (password.length < PASSWORD_MIN) {
      return json(400, { error: `Password must be at least ${PASSWORD_MIN} characters` });
    }
    if (password.length > PASSWORD_MAX) return json(400, { error: 'Password is too long' });

    // Resolve the name first: it makes the audit log readable, and it rejects
    // an id that is not a crew member before touching the auth tables.
    const { data: target, error: lookupError } = await admin
      .from('profiles')
      .select('id,username')
      .eq('id', targetId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!target) return json(404, { error: 'No such user' });

    const { error } = await admin.auth.admin.updateUserById(targetId, { password });
    if (error) return json(400, { error: error.message || 'Could not update that password' });

    // Deliberately loud. A password change made by someone other than the
    // account owner should always be greppable afterwards.
    console.log(`[admin-set-password] ${senderName || senderId} set the password for ${target.username} (${targetId})`);

    return json(200, { ok: true, username: target.username, changedBy: senderName || senderId });
  } catch (error) {
    console.error('[admin-set-password] failed', error);
    return json(500, { error: (error as Error).message || 'Password update failed' });
  }
});
