/*
 * Unified backend adapter.
 * - Server mode (default): talks to the Express API + WebSocket (npm run dev).
 * - Static mode: when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set at build
 *   time, talks to Supabase directly (auth, postgrest, realtime) — no Node server.
 *   This is what makes a GitHub Pages deployment work.
 */
import { timeBucket, achievements } from './rules.js';

// Canonical set of valid achievement IDs – used in Supabase mode to block forgery.
const VALID_ACHIEVEMENT_IDS = new Set(achievements.map(a => a.id));

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isStatic = Boolean(SUPA_URL && SUPA_KEY);

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
  async saveAchievements(types) { return (await rest('/achievements', { method: 'POST', body: JSON.stringify({ types }) })).achievements; },
  async patchProfile(patch) { return (await rest('/profile', { method: 'PATCH', body: JSON.stringify(patch) })).user; },
  subscribe({ onBust, onProfile }) {
    // Auto-reconnecting WebSocket with exponential backoff (1s → 15s cap).
    let ws = null, closed = false, delay = 1000;
    const connect = () => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${localStorage.getItem('bust_token')}`);
      ws.onopen = () => { delay = 1000; };
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          // Support both legacy 'bust' and explicit 'bust.created'/'bust.updated' event types.
          if (msg.type === 'bust' || msg.type === 'bust.created' || msg.type === 'bust.updated') {
            onBust?.(msg.bust, msg.type === 'bust.updated' ? 'updated' : 'created');
          }
          if (msg.type === 'profile' || msg.type === 'profile.updated') onProfile?.(msg.user);
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = (event) => {
        // Code 4001 signals authentication failure – stop reconnecting.
        if (closed || event.code === 4001) return;
        setTimeout(connect, delay = Math.min(delay * 2, 15000));
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };
    connect();
    return () => { closed = true; try { ws?.close(); } catch {} };
  }
};

/* ---------------------------------- static / Supabase mode ---------------------------------- */
let supa = null;
let profileCache = new Map();
async function getSupa() {
  if (!supa) {
    const { createClient } = await import('@supabase/supabase-js');
    supa = createClient(SUPA_URL, SUPA_KEY);
  }
  return supa;
}
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
    if (inviteCode !== 'Bust4Me') throw new Error('That secret handshake is not on the list.');
    if (!/^[a-zA-Z0-9_ -]{2,32}$/.test(username)) throw new Error('Username must be 2-32 simple characters');
    if (String(password).length < 6) throw new Error('Password must be at least 6 characters');
    const sb = await getSupa();
    const taken = await sb.from('profiles').select('id').ilike('username', username.trim()).maybeSingle();
    if (taken.data) throw new Error('Username already exists');
    const { data, error } = await sb.auth.signUp({ email: synthEmail(username), password });
    if (error) throw new Error(/already/i.test(error.message) ? 'Username already exists' : error.message);
    const uid = data.user?.id;
    if (!uid) throw new Error('Signup failed — is email confirmation disabled in Supabase Auth settings?');
    const profile = { id: uid, username: username.trim(), avatar_seed: `${username}-${Date.now()}` };
    const ins = await sb.from('profiles').insert(profile).select().single();
    if (ins.error) { await sb.auth.signOut(); throw new Error(ins.error.code === '23505' ? 'Username already exists' : ins.error.message); }
    return toUser(ins.data);
  },
  async logout() { const sb = await getSupa(); await sb.auth.signOut(); },
  async deleteAccount() {
    // Anon key can't remove the auth.users row (needs service role) — deleting the
    // profile cascades busts/achievements and frees the username, then we sign out.
    const sb = await getSupa();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not signed in');
    const { error } = await sb.from('profiles').delete().eq('id', user.id);
    if (error) throw new Error(error.message);
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
  async bust(payload) {
    const sb = await getSupa();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not signed in');
    const now = new Date();
    const row = { user_id: user.id, timestamp: now.toISOString(), note: String(payload.note || '').slice(0, 240), temp_f: payload.temp_f, pressure: payload.pressure, lat: payload.lat, long: payload.long, city: payload.city, elevation_ft: payload.elevation_ft, tide_ft: payload.tide_ft, time_bucket: timeBucket(now) };
    const { data, error } = await sb.from('busts').insert(row).select().single();
    if (error) throw new Error(/policy|row-level/i.test(error.message) ? 'Cooldown is still active' : error.message);
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
  async saveAchievements(types) {
    const sb = await getSupa();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Not signed in');
    // Filter to only catalog IDs to prevent arbitrary achievement injection.
    const validTypes = types.filter(t => VALID_ACHIEVEMENT_IDS.has(t));
    if (validTypes.length) {
      const rows = validTypes.slice(0, 60).map(t => ({ user_id: user.id, achievement_type: t }));
      const { error } = await sb.from('achievements').upsert(rows, { onConflict: 'user_id,achievement_type', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    const { data, error } = await sb.from('achievements').select('*').order('unlocked_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  },
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
  subscribe({ onBust, onProfile }) {
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
        .subscribe();
    });
    return () => { unsubscribed = true; channel?.unsubscribe(); };
  }
};

export const backend = isStatic ? staticBackend : serverBackend;
