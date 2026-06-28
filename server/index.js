import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { query } from './db.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const COOLDOWN_MS = 2 * 60 * 60 * 1000;

app.use(cors());
app.use(express.json({ limit: '64kb' }));

function sign(user) { return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' }); }
function publicUser(u) { return { id: u.id, username: u.username, avatar_seed: u.avatar_seed, created_at: u.created_at, last_bust_timestamp: u.last_bust_timestamp }; }
function timeBucket(date = new Date()) { const h = date.getHours(); if (h < 4) return 'Late Night'; if (h < 8) return 'Early Morning'; if (h < 12) return 'Morning'; if (h < 17) return 'Afternoon'; if (h < 21) return 'Evening'; return 'Prime Night'; }
async function auth(req, res, next) { try { const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!raw) throw new Error('missing'); const payload = jwt.verify(raw, JWT_SECRET); const { rows } = await query('select * from users where id=$1', [payload.id]); if (!rows[0]) throw new Error('missing user'); req.user = rows[0]; next(); } catch { res.status(401).json({ error: 'Authentication required' }); } }
async function bustRows(limit = 300) { const { rows } = await query(`select b.*, u.username, u.avatar_seed from busts b join users u on u.id=b.user_id order by b.timestamp desc limit $1`, [limit]); return rows; }

app.post('/api/signup', async (req, res) => {
  const { username = '', password = '', inviteCode = '' } = req.body || {};
  if (inviteCode !== 'Bust4Me') return res.status(403).json({ error: 'Invalid invite-code' });
  if (!/^[a-zA-Z0-9_ -]{2,32}$/.test(username)) return res.status(400).json({ error: 'Username must be 2-32 simple characters' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const hash = await bcrypt.hash(password, 12);
  const synthetic = `${username.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}@bust.local`;
  try {
    const { rows } = await query('insert into users (username, synthetic_email, password_hash, avatar_seed) values ($1,$2,$3,$4) returning *', [username.trim(), synthetic, hash, `${username}-${Date.now()}`]);
    res.json({ user: publicUser(rows[0]), token: sign(rows[0]) });
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') return res.status(503).json({ error: 'Database is unreachable; check DATABASE_URL or network/DNS access' });
    res.status(409).json({ error: 'Username already exists' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const { rows } = await query('select * from users where lower(username)=lower($1)', [username.trim()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ user: publicUser(user), token: sign(user) });
});
app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.get('/api/dashboard', auth, async (req, res) => {
  const [users, busts, achievements] = await Promise.all([
    query('select id, username, avatar_seed, created_at, last_bust_timestamp from users order by created_at asc'),
    bustRows(),
    query('select * from achievements order by unlocked_at desc')
  ]);
  res.json({ users: users.rows, busts, achievements: achievements.rows });
});
app.post('/api/bust', auth, async (req, res) => {
  const fresh = (await query('select last_bust_timestamp from users where id=$1', [req.user.id])).rows[0];
  if (fresh?.last_bust_timestamp && Date.now() - new Date(fresh.last_bust_timestamp).getTime() < COOLDOWN_MS) return res.status(429).json({ error: 'Cooldown is still active' });
  const now = new Date();
  const { note = '', temp_f = null, pressure = null, lat = null, long = null, city = null } = req.body || {};
  const { rows } = await query(`insert into busts (user_id, timestamp, note, temp_f, pressure, lat, long, city, time_bucket) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [req.user.id, now, String(note).slice(0, 240), temp_f, pressure, lat, long, city, timeBucket(now)]);
  await query('update users set last_bust_timestamp=$1 where id=$2', [now, req.user.id]);
  const full = (await query(`select b.*, u.username, u.avatar_seed from busts b join users u on u.id=b.user_id where b.id=$1`, [rows[0].id])).rows[0];
  broadcast({ type: 'bust', bust: full });
  res.json({ bust: full });
});
app.post('/api/achievements', auth, async (req, res) => {
  const types = Array.isArray(req.body?.types) ? req.body.types.slice(0, 11) : [];
  for (const t of types) await query('insert into achievements (user_id, achievement_type) values ($1,$2) on conflict do nothing', [req.user.id, t]);
  const { rows } = await query('select * from achievements order by unlocked_at desc');
  res.json({ achievements: rows });
});

function broadcast(obj) { const data = JSON.stringify(obj); for (const client of wss.clients) if (client.readyState === 1) client.send(data); }
wss.on('connection', (ws, req) => { try { const token = new URL(req.url, 'http://localhost').searchParams.get('token'); jwt.verify(token, JWT_SECRET); ws.send(JSON.stringify({ type: 'hello' })); } catch { ws.close(); } });

app.use((err, req, res, next) => {
  console.error(err);
  if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT') return res.status(503).json({ error: 'Database is unreachable; check DATABASE_URL or network/DNS access' });
  res.status(500).json({ error: 'Internal server error' });
});

server.listen(PORT, () => console.log(`BUST API listening on ${PORT}`));

