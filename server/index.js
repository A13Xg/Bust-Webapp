import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { query, withTransaction } from './db.js';
import { SCHEMA_SQL } from './schema.js';
import { computeAchievementUnlocks, achievements } from '../src/rules.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET']);

app.use(cors());
app.use(express.json({ limit: '64kb' }));

function sign(user) { return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' }); }
function publicUser(u) { return { id: u.id, username: u.username, avatar_seed: u.avatar_seed, created_at: u.created_at, last_bust_timestamp: u.last_bust_timestamp, tagline: u.tagline || null, showcase: u.showcase || null }; }
function timeBucket(date = new Date()) { const h = date.getHours(); if (h < 4) return 'Late Night'; if (h < 8) return 'Early Morning'; if (h < 12) return 'Morning'; if (h < 17) return 'Afternoon'; if (h < 21) return 'Evening'; return 'Prime Night'; }
function dbErrorResponse(res, e) {
  console.error('[db]', e.code || '', e.message);
  if (NETWORK_CODES.has(e.code)) return res.status(503).json({ error: 'Database is unreachable; check DATABASE_URL or network/DNS access' });
  if (e.code === '42P01') return res.status(503).json({ error: 'Database tables are missing — run: npm run db:migrate' });
  if (e.code === '42703') return res.status(503).json({ error: 'Database schema is outdated — run: npm run db:migrate' });
  return res.status(500).json({ error: `Database error${e.code ? ` (${e.code})` : ''}: ${e.message}` });
}
async function auth(req, res, next) { try { const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!raw) throw new Error('missing'); const payload = jwt.verify(raw, JWT_SECRET); const { rows } = await query('select * from users where id=$1', [payload.id]); if (!rows[0]) throw new Error('missing user'); req.user = rows[0]; next(); } catch { res.status(401).json({ error: 'Authentication required' }); } }
async function bustRows(limit = 300) { const { rows } = await query(`select b.*, u.username, u.avatar_seed from busts b join users u on u.id=b.user_id order by b.timestamp desc limit $1`, [limit]); return rows; }

app.get('/api/health', async (req, res) => {
  try { await query('select 1', []); res.json({ ok: true, db: 'connected' }); }
  catch (e) { res.status(503).json({ ok: false, db: 'unreachable', code: e.code || null, message: e.message }); }
});

app.post('/api/signup', async (req, res) => {
  const { username = '', password = '', inviteCode = '' } = req.body || {};
  if (inviteCode !== 'Bust4Me') return res.status(403).json({ error: 'That secret handshake is not on the list.' });
  if (!/^[a-zA-Z0-9_ -]{2,32}$/.test(username)) return res.status(400).json({ error: 'Username must be 2-32 simple characters' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const hash = await bcrypt.hash(password, 12);
  const synthetic = `${username.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}@bust.local`;
  try {
    const { rows } = await query('insert into users (username, synthetic_email, password_hash, avatar_seed) values ($1,$2,$3,$4) returning *', [username.trim(), synthetic, hash, `${username}-${Date.now()}`]);
    res.json({ user: publicUser(rows[0]), token: sign(rows[0]) });
  } catch (e) {
    // Only a genuine unique-constraint violation means the name is taken.
    if (e.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    dbErrorResponse(res, e);
  }
});

app.post('/api/login', async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  try {
    const { rows } = await query('select * from users where lower(username)=lower($1)', [username.trim()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid username or password' });
    res.json({ user: publicUser(user), token: sign(user) });
  } catch (e) { dbErrorResponse(res, e); }
});
app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const [users, busts, achievementsResult] = await Promise.all([
      query('select id, username, avatar_seed, created_at, last_bust_timestamp, tagline, showcase from users order by created_at asc'),
      bustRows(),
      query('select * from achievements order by unlocked_at desc')
    ]);
    res.json({ users: users.rows, busts, achievements: achievementsResult.rows });
  } catch (e) { dbErrorResponse(res, e); }
});
app.post('/api/bust', auth, async (req, res) => {
  try {
    const now = new Date();
    const { note = '', temp_f = null, pressure = null, lat = null, long = null, city = null, elevation_ft = null, tide_ft = null } = req.body || {};
    const bustRow = await withTransaction(async (client) => {
      // Lock the user row and check cooldown atomically.
      // Two concurrent requests will serialize here; only one will find the row eligible.
      const { rows: lockRows } = await client.query(
        `select id from users where id=$1 and (last_bust_timestamp is null or now() - last_bust_timestamp >= interval '2 hours') for update`,
        [req.user.id]
      );
      if (!lockRows[0]) {
        const err = new Error('Cooldown is still active'); err.code = 'COOLDOWN'; throw err;
      }
      const { rows } = await client.query(
        `insert into busts (user_id, timestamp, note, temp_f, pressure, lat, long, city, elevation_ft, tide_ft, time_bucket) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [req.user.id, now, String(note).slice(0, 240), temp_f, pressure, lat, long, city, elevation_ft, tide_ft, timeBucket(now)]
      );
      await client.query('update users set last_bust_timestamp=$1 where id=$2', [now, req.user.id]);
      return rows[0];
    });
    const full = (await query(`select b.*, u.username, u.avatar_seed from busts b join users u on u.id=b.user_id where b.id=$1`, [bustRow.id])).rows[0];
    broadcast({ type: 'bust.created', bust: full });
    res.json({ bust: full });
  } catch (e) {
    if (e.code === 'COOLDOWN') return res.status(429).json({ error: 'Cooldown is still active' });
    dbErrorResponse(res, e);
  }
});
app.patch('/api/bust/:id/note', auth, async (req, res) => {
  try {
    const note = String(req.body?.note || '').slice(0, 240);
    const { rows } = await query('update busts set note=$1 where id=$2 and user_id=$3 returning *', [note, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Bust not found' });
    const full = (await query(`select b.*, u.username, u.avatar_seed from busts b join users u on u.id=b.user_id where b.id=$1`, [rows[0].id])).rows[0];
    broadcast({ type: 'bust.updated', bust: full });
    res.json({ bust: full });
  } catch (e) { dbErrorResponse(res, e); }
});
app.patch('/api/profile', auth, async (req, res) => {
  try {
    const tagline = req.body?.tagline != null ? String(req.body.tagline).slice(0, 80) : req.user.tagline;
    const avatar_seed = req.body?.avatar_seed != null ? String(req.body.avatar_seed).slice(0, 64) : req.user.avatar_seed;
    // showcase: up to 3 comma-separated achievement ids pinned beside the username
    const showcase = req.body?.showcase != null ? String(req.body.showcase).split(',').filter(Boolean).slice(0, 3).join(',') : req.user.showcase;
    const { rows } = await query('update users set tagline=$1, avatar_seed=$2, showcase=$3 where id=$4 returning *', [tagline, avatar_seed, showcase, req.user.id]);
    broadcast({ type: 'profile.updated', user: publicUser(rows[0]) });
    res.json({ user: publicUser(rows[0]) });
  } catch (e) { dbErrorResponse(res, e); }
});
app.delete('/api/account', auth, async (req, res) => {
  try {
    await query('delete from users where id=$1', [req.user.id]); // busts/achievements cascade
    broadcast({ type: 'user.deleted', id: req.user.id });
    res.json({ ok: true });
  } catch (e) { dbErrorResponse(res, e); }
});


/**
 * POST /api/achievements — server-side authoritative achievement reconciliation.
 *
 * Computes which achievements the authenticated user has legitimately earned from
 * their complete bust history, persists any that are missing, and returns the full
 * list. Only server-computed earned IDs are persisted; client-submitted IDs are
 * ignored to prevent privilege escalation.
 */
app.post('/api/achievements', auth, async (req, res) => {
  try {
    const [allBustsResult, existingResult, userCountResult] = await Promise.all([
      bustRows(1000),
      query('select * from achievements', []),
      query('select count(*) from users', [])
    ]);
    const userCount = Number(userCountResult.rows[0].count);
    const toSave = computeAchievementUnlocks(
      req.user.id,
      allBustsResult,
      existingResult.rows,
      { createdAt: req.user.created_at, userCount }
    );
    for (const t of toSave) {
      await query('insert into achievements (user_id, achievement_type) values ($1,$2) on conflict do nothing', [req.user.id, t]);
    }
    const { rows } = await query('select * from achievements order by unlocked_at desc');
    res.json({ achievements: rows });
  } catch (e) { dbErrorResponse(res, e); }
});

function broadcast(obj) { const data = JSON.stringify(obj); for (const client of wss.clients) if (client.readyState === 1) client.send(data); }
wss.on('connection', (ws, req) => { try { const token = new URL(req.url, 'http://localhost').searchParams.get('token'); jwt.verify(token, JWT_SECRET); ws.send(JSON.stringify({ type: 'hello' })); } catch { ws.close(); } });

app.use((err, req, res, next) => {
  console.error(err);
  if (NETWORK_CODES.has(err?.code)) return res.status(503).json({ error: 'Database is unreachable; check DATABASE_URL or network/DNS access' });
  res.status(500).json({ error: 'Internal server error' });
});

// Ensure schema exists on boot so a fresh database never masquerades as "username taken".
try { await query(SCHEMA_SQL, []); console.log('Schema verified.'); }
catch (e) { console.warn(`Schema check skipped (${e.code || e.message}) — run npm run db:migrate once the database is reachable.`); }

server.listen(PORT, () => console.log(`BUST API listening on ${PORT}`));
