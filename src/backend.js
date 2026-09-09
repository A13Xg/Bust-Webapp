/*
 * Unified backend adapter.
 * - Server mode (default): talks to the Express API + WebSocket (npm run dev).
 * - Static mode: when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set at build
 *   time, talks to Supabase directly (auth, postgrest, realtime) — no Node server.
 *   This is what makes a GitHub Pages deployment work.
 */
import { timeBucket } from './rules.js';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const WEB_PUSH_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || '';
export const isStatic = Boolean(SUPA_URL && SUPA_KEY);
const RECONNECT_JITTER_MS = 700;

/* ---------------------------------- server mode ---------------------------------- */
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('bust_token') || '') });
async function rest(path, options = {}) {
  const res = await fetch('/api' + path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const serverBackend = {
  async me() { return (await rest('/me')).user; },
  async login({ username, password }) { const d = await rest('/login', { method: 'POST', body: JSON.stringify({ username, password }) }); localStorage.setItem('bust_token', d.token); return d.user; },
  async signup({ username, password, inviteCode }) { const d = await rest('/signup', { method: 'POST', body: JSON.stringify({ username, password, inviteCode }) }); localStorage.setItem('bust_token', d.token); return d.user; },
  async logout() { localStorage.removeItem('bust_token'); },
  async deleteAccount() { await rest('/account', { method: 'DELETE' }); localStorage.removeItem('bust_token'); },
  async dashboard() { return rest('/dashboard'); },
  async bust(payload) { return (await rest('/bust', { method: 'POST', body: JSON.stringify(payload) })).bust; },
  async patchBustNote(id, note) { return (await rest(`/bust/${encodeURIComponent(id)}/note`, { method: 'PATCH', body: JSON.stringify({ note }) })).bust; },
  async recentBusts(limit = 60) { return (await rest(`/busts/recent?limit=${encodeURIComponent(limit)}`)).busts; },
  async reconcileAchievements() { return await rest('/achievements/reconcile', { method: 'POST' }); },
  async saveAchievements() { return (await this.reconcileAchievements()).achievements; },
  async registerPushSubscription(subscription, meta = {}) {
    return await rest('/push-subscriptions', { method: 'POST', body: JSON.stringify({ subscription, ...meta }) });
  },
  // Server mode has no VAPID sender; the open tab notifies locally instead.
  async notifyEvent() { return { ok: false, reason: 'unsupported_in_server_mode' }; },
  async broadcastTestNotification() { return { ok: false, reason: 'unsupported_in_server_mode' }; },
  async adminSetPassword() { return { ok: false, reason: 'unsupported_in_server_mode' }; },
  webPushPublicKey() { return WEB_PUSH_PUBLIC_KEY; },
  async patchProfile(patch) { return (await rest('/profile', { method: 'PATCH', body: JSON.stringify(patch) })).user; },
  subscribe({ onBust, onProfile, onStatus }) {
    let ws = null, closed = false, delay = 1000, reconnectTimer = null;
    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };
    const scheduleReconnect = () => {
      clearReconnect();
      const base = delay = Math.min(delay * 2, 15000);
      const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS);
      reconnectTimer = setTimeout(connect, base + jitter);
    };
    const connect = () => {
      if (closed) return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${localStorage.getItem('bust_token')}`);
      ws.onopen = () => { clearReconnect(); delay = 1000; onStatus?.('SUBSCRIBED'); };
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'bust' || msg.type === 'bust.created' || msg.type === 'bust.updated') {
            onBust?.(msg.bust, msg.type === 'bust.updated' ? 'updated' : 'created');
          }
          if (msg.type === 'profile' || msg.type === 'profile.updated') onProfile?.(msg.user);
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = event => {
        ws = null;
        if (closed || event.code === 4001) { onStatus?.('CLOSED'); return; }
        onStatus?.('TIMED_OUT');
        scheduleReconnect();
      };
      ws.onerror = () => { onStatus?.('CHANNEL_ERROR'); try { ws.close(); } catch {} };
    };
    connect();
    return () => { closed = true; clearReconnect(); try { ws?.close(); } catch {} ws = null; onStatus?.('CLOSED'); };
  }
};

/* ---------------------------------- static / Supabase mode ---------------------------------- */
let supa = null;
let profileCache = new Map();
/* supabase-js reports a non-2xx Edge Function response as a generic
 * FunctionsHttpError and tucks the real response on `context`. Without this the
 * UI can only say "Edge Function returned a non-2xx status code". */
async function readFunctionError(error) {
  try {
    const payload = await error?.context?.json?.();
    return payload?.error || null;
  } catch {
    return null;
  }
}

async function getSupa() {
  if (!supa) {
    const { createClient } = await import('@supabase/supabase-js');
    supa = createClient(SUPA_URL, SUPA_KEY);
  }
  return supa;
}
/* Compared case-insensitively and trimmed. This code ships inside the client
 * bundle either way, so guarding its capitalisation buys nothing and only makes
 * it annoying to type. */
const INVITE_CODE = 'bust4me';
const synthEmail = u => `${String(u).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}@bust-ops.dev`;
function toUser(p) { return p ? { id: p.id, username: p.username, avatar_seed: p.avatar_seed, created_at: p.created_at, last_bust_timestamp: p.last_bust_timestamp, tagline: p.tagline || null, showcase: p.showcase || null } : null; }
function joinBust(b) { const p = profileCache.get(b.user_id) || {}; return { ...b, username: p.username || 'Unknown', avatar_seed: p.avatar_seed || 'bust' }; }
async function refreshProfiles(sb) {
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  profileCache = new Map(data.map(p => [p.id, p]));
  return data;
}
async function myProfile(sb) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw new Error(error.message);
  return toUser(data);
}

const staticBackend = {
  async me() { const sb = await getSupa(); return myProfile(sb); },
  async login({ username, password }) {
    const sb = await getSupa();
    const { error } = await sb.auth.signInWithPassword({ email: synthEmail(username), password });
    if (error) throw new Error('Invalid username or password');
    return myProfile(sb);
  },
  async signup({ username, password, inviteCode }) {
    if (String(inviteCode).trim().toLowerCase() !== INVITE_CODE) throw new Error('That secret handshake is not on the list.');
    if (!/^[a-zA-Z0-9_ -]{2,32}$/.test(username)) throw new Error('Username must be 2-32 simple characters');
    if (String(password).length < 6) throw new Error('Password must be at least 6 characters');
    const sb = await getSupa();
    // Not ilike: '_' and '%' are wildcards there and the username pattern permits
    // '_', so 'Alex_' matched an existing 'AlexG' and was wrongly reported taken.
    // This is a courtesy check only — the unique index on lower(username) is the
    // real guard, and it is what closes the race between check and insert.
    const wanted = username.trim();
    const taken = await sb.from('profiles').select('id').eq('username', wanted).maybeSingle();
    if (taken.data) throw new Error('Username already exists');
    const { data, error } = await sb.auth.signUp({ email: synthEmail(username), password });
    if (error) throw new Error(/already/i.test(error.message) ? 'Username already exists' : error.message);
    const uid = data.user?.id;
    if (!uid) throw new Error('Signup failed — is email confirmation disabled in Supabase Auth settings?');
    const profile = { id: uid, username: username.trim(), avatar_seed: `${username}-${Date.now()}` };
    const ins = await sb.from('profiles').insert(profile).select().single();
    if (ins.error) { await sb.auth.signOut(); throw new Error(ins.error.code === '23505' || /profiles_username_lower_key/.test(ins.error.message || '') ? 'Username already exists' : ins.error.message); }
    return toUser(ins.data);
  },
  async logout() { const sb = await getSupa(); await sb.auth.signOut(); },
  /* Deletes the auth user, not just the profile. Removing only the profile left
   * the auth.users row behind holding this username's synthetic email, so
   * signing up again with the same name failed as "Username already exists".
   * Deleting the auth user cascades the profile away and frees the name. */
  async deleteAccount() {
    const sb = await getSupa();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not signed in');
    const { data, error } = await sb.functions.invoke('delete-account', { body: {} });
    if (error) {
      const detail = await readFunctionError(error);
      throw new Error(detail || error.message || 'Account deletion failed');
    }
    if (data?.error) throw new Error(data.error);
    await sb.auth.signOut();
  },
  async dashboard() {
    const sb = await getSupa();
    const [profiles, busts, achievements] = await Promise.all([
      refreshProfiles(sb),
      sb.from('busts').select('*').order('timestamp', { ascending: false }).limit(300),
      sb.from('achievements').select('*').order('unlocked_at', { ascending: false })
    ]);
    if (busts.error) throw new Error(busts.error.message);
    if (achievements.error) throw new Error(achievements.error.message);
    return { users: profiles.map(toUser), busts: busts.data.map(joinBust), achievements: achievements.data };
  },
  async recentBusts(limit = 60) {
    const sb = await getSupa();
    const result = await sb.from('busts').select('*').order('timestamp', { ascending: false }).limit(Math.max(1, Math.min(200, Number(limit) || 60)));
    if (result.error) throw new Error(result.error.message);
    if (!profileCache.size) { try { await refreshProfiles(sb); } catch {} }
    return result.data.map(joinBust);
  },
  async bust(payload) {
    const sb = await getSupa();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not signed in');
    const now = new Date();
    const row = { user_id: user.id, timestamp: now.toISOString(), note: String(payload.note || '').slice(0, 240), temp_f: payload.temp_f, pressure: payload.pressure, lat: payload.lat, long: payload.long, city: payload.city, elevation_ft: payload.elevation_ft, tide_ft: payload.tide_ft, btc_usd: payload.btc_usd, time_bucket: timeBucket(now) };
    const { data, error } = await sb.from('busts').insert(row).select().single();
    if (error) throw new Error(/policy|row-level|cooldown/i.test(error.message) ? 'Cooldown is still active' : error.message);
    return joinBust(data);
  },
  async patchBustNote(id, note) {
    const sb = await getSupa();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not signed in');
    const { data, error } = await sb.from('busts').update({ note: String(note || '').slice(0, 240) }).eq('id', id).eq('user_id', user.id).select().single();
    if (error) throw new Error(error.message);
    return joinBust(data);
  },
  async reconcileAchievements() {
    const sb = await getSupa();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not signed in');
    const { data, error } = await sb.functions.invoke('reconcile-achievements', { body: {} });
    if (error) throw new Error(error.message || 'Achievement reconciliation failed');
    if (data?.error) throw new Error(data.error);
    if (!Array.isArray(data?.achievements)) throw new Error('Achievement reconciliation returned an invalid response');
    return { achievements: data.achievements };
  },
  async saveAchievements() { return (await this.reconcileAchievements()).achievements; },
  async registerPushSubscription(subscription, meta = {}) {
    if (!subscription) return { ok: false, reason: 'missing_subscription' };
    const sb = await getSupa();
    const { data, error } = await sb.functions.invoke('register-push-subscription', {
      body: { subscription, ...meta },
    });
    if (error) throw new Error(error.message || 'Push subscription registration failed');
    if (data?.error) throw new Error(data.error);
    return data || { ok: true };
  },
  /* Announce one of the caller's own rows to the rest of the crew. Fire-and-forget
   * from the caller's perspective: dispatch-push-backstop re-sends anything this
   * call loses, and the push_events ledger stops it arriving twice. */
  async notifyEvent(kind, id) {
    if (!kind || !id) return { ok: false, reason: 'missing_event' };
    const sb = await getSupa();
    const { data, error } = await sb.functions.invoke('notify-event', { body: { kind, id } });
    if (error) throw new Error(error.message || 'Crew notification failed');
    if (data?.error) throw new Error(data.error);
    return data || { ok: true };
  },
  /* Debug-menu only: push an arbitrary message to EVERY registered device,
   * including the caller's own. Server-side an allowlist decides who may do
   * this; deliberately not run through the push_events ledger, because a
   * manual test send is something you may legitimately want to repeat. */
  async broadcastTestNotification({ title, body, userIds } = {}) {
    if (!String(title || '').trim() && !String(body || '').trim()) return { ok: false, reason: 'empty_message' };
    const sb = await getSupa();
    const { data, error } = await sb.functions.invoke('broadcast-test-notification', { body: { title, body, userIds } });
    if (error) {
      // The function returns 403 for a non-allowlisted caller; surface the
      // function's own message rather than the SDK's generic wrapper.
      const detail = await readFunctionError(error);
      throw new Error(detail || error.message || 'Broadcast failed');
    }
    if (data?.error) throw new Error(data.error);
    return data || { ok: true };
  },
  /* Debug-menu only: set another account's password outright. The service-role
   * key that makes this possible never leaves the Edge Function; the same
   * allowlist that gates broadcasting gates this, and it is strictly more
   * powerful — it is account takeover. */
  async adminSetPassword({ userId, password } = {}) {
    if (!userId) return { ok: false, reason: 'missing_user' };
    if (String(password || '').length < 6) return { ok: false, reason: 'password_too_short' };
    const sb = await getSupa();
    const { data, error } = await sb.functions.invoke('admin-set-password', { body: { userId, password } });
    if (error) {
      const detail = await readFunctionError(error);
      throw new Error(detail || error.message || 'Password update failed');
    }
    if (data?.error) throw new Error(data.error);
    return data || { ok: true };
  },
  webPushPublicKey() { return WEB_PUSH_PUBLIC_KEY; },
  async patchProfile(patch) {
    const sb = await getSupa();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not signed in');
    const upd = {};
    if (patch.tagline != null) upd.tagline = String(patch.tagline).slice(0, 80);
    if (patch.avatar_seed != null) upd.avatar_seed = String(patch.avatar_seed).slice(0, 64);
    if (patch.showcase != null) upd.showcase = String(patch.showcase).split(',').filter(Boolean).slice(0, 3).join(',');
    const { data, error } = await sb.from('profiles').update(upd).eq('id', user.id).select().single();
    if (error) throw new Error(error.message);
    profileCache.set(data.id, data);
    return toUser(data);
  },
  subscribe({ onBust, onProfile, onStatus }) {
    let channel;
    let unsubscribed = false;
    getSupa().then(sb => {
      if (unsubscribed) return;
      channel = sb.channel('bust-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'busts' }, async payload => {
          if (!profileCache.has(payload.new.user_id)) { try { await refreshProfiles(sb); } catch {} }
          onBust?.(joinBust(payload.new), 'created');
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'busts' }, async payload => {
          if (!profileCache.has(payload.new.user_id)) { try { await refreshProfiles(sb); } catch {} }
          onBust?.(joinBust(payload.new), 'updated');
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, payload => {
          profileCache.set(payload.new.id, payload.new);
          onProfile?.(toUser(payload.new));
        })
        .subscribe(status => {
          if (unsubscribed) return;
          if (status === 'SUBSCRIBED') onStatus?.('SUBSCRIBED');
          else if (status === 'CHANNEL_ERROR') onStatus?.('CHANNEL_ERROR');
          else if (status === 'TIMED_OUT') onStatus?.('TIMED_OUT');
          else if (status === 'CLOSED') onStatus?.('CLOSED');
        });
    });
    return () => { unsubscribed = true; channel?.unsubscribe(); onStatus?.('CLOSED'); };
  }
};

export const backend = isStatic ? staticBackend : serverBackend;
