/*
 * Who is allowed to use the privileged debug functions.
 *
 * Shared by `broadcast-test-notification` and `admin-set-password` so the
 * security-critical check exists once. A copy that drifts is how one of two
 * endpoints ends up quietly weaker than the other.
 *
 * BROADCAST_ADMINS holds comma-separated SHA-256 hex digests. A digest may be
 * of a profile UUID or of a lower-cased username; both are accepted, and since
 * usernames are now case-insensitively unique AND immutable at the database
 * level (migrations/20260908010000_username_case_insensitive.sql), neither can be
 * moved onto the allowlist by a crew member any more.
 *
 * Generate a digest with:
 *   node -e "console.log(require('crypto').createHash('sha256').update('VALUE').digest('hex'))"
 *
 * The default is the digest of the project owner's username, so a deploy that
 * forgets the secret fails closed to one account rather than open to everyone.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_ADMIN_HASHES = ['c796c9789455782ec850c0fe2d0e843efd7f27d31b8c1623298ecb8b91e77d0a'];

export function adminAllowlist() {
  const raw = Deno.env.get('BROADCAST_ADMINS') || '';
  const entries = raw
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
  return entries.length ? entries : DEFAULT_ADMIN_HASHES;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function isAllowedAdmin(userId: string, username: string | null) {
  const list = adminAllowlist();
  // Empty identifiers are never candidates: hashing '' would otherwise let a
  // digest of the empty string match every profile that has no username.
  const identifiers = [String(username || '').trim(), String(userId || '').trim()]
    .filter(Boolean)
    .map(value => value.toLowerCase());
  for (const identifier of identifiers) {
    if (list.includes(await sha256Hex(identifier))) return true;
  }
  return false;
}

export type AdminContext = { admin: SupabaseClient; senderId: string; senderName: string | null };

/**
 * Authenticate the caller and confirm they are on the allowlist.
 *
 * Returns either a `Response` to send back immediately, or the service-role
 * client plus the caller's identity. Callers must check `denied` first.
 */
export async function requireAdmin(
  req: Request,
  json: (status: number, body: unknown) => Response
): Promise<{ denied: Response; context?: never } | { denied?: never; context: AdminContext }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Supabase function environment is incomplete');

  const authorization = req.headers.get('Authorization');
  if (!authorization) return { denied: json(401, { error: 'Authentication required' }) };

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return { denied: json(401, { error: 'Authentication required' }) };
  const senderId = authData.user.id;

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: profile } = await admin.from('profiles').select('username').eq('id', senderId).maybeSingle();
  const senderName = profile?.username || null;

  if (!(await isAllowedAdmin(senderId, senderName))) {
    console.warn('[admin] refused', senderId, senderName);
    return { denied: json(403, { error: 'This account is not allowed to perform admin actions.' }) };
  }

  return { context: { admin, senderId, senderName } };
}
