import 'dotenv/config';
import { randomUUID } from 'crypto';
import pg from 'pg';

const { Pool } = pg;
const useMemory = process.env.DEMO_DB === '1' || !process.env.DATABASE_URL;
const state = { users: [], busts: [], achievements: [] };

function normalize(sql) { return String(sql).replace(/\s+/g, ' ').trim().toLowerCase(); }
function clone(row) { return row ? { ...row } : row; }
function maybeNumber(value) { return value == null || value === '' ? null : Number(value); }
function resetMemory() { state.users = []; state.busts = []; state.achievements = []; }
function userPublicSort() { return [...state.users].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); }
function bustJoined(row) { const user = state.users.find(u => u.id === row.user_id) || {}; return { ...row, username: user.username, avatar_seed: user.avatar_seed }; }

async function memoryQuery(text, params = []) {
  const sql = normalize(text);
  if (sql.includes('drop table')) { resetMemory(); return { rows: [] }; }
  if (sql.includes('create table') || sql.includes('create extension') || sql.includes('create index')) return { rows: [] };

  if (sql.startsWith('insert into users')) {
    const [username, synthetic_email, password_hash, avatar_seed] = params;
    if (state.users.some(u => u.username.toLowerCase() === String(username).toLowerCase())) {
      const err = new Error('duplicate username'); err.code = '23505'; throw err;
    }
    const row = { id: randomUUID(), username, synthetic_email, password_hash, avatar_seed, created_at: new Date().toISOString(), last_bust_timestamp: null };
    state.users.push(row);
    return { rows: [clone(row)] };
  }

  if (sql.startsWith('select * from users where id=')) return { rows: state.users.filter(u => u.id === params[0]).map(clone) };
  if (sql.startsWith('select * from users where lower(username)=')) return { rows: state.users.filter(u => u.username.toLowerCase() === String(params[0]).toLowerCase()).map(clone) };
  if (sql.startsWith('select id, username, avatar_seed, created_at, last_bust_timestamp from users')) {
    return { rows: userPublicSort().map(({ id, username, avatar_seed, created_at, last_bust_timestamp }) => ({ id, username, avatar_seed, created_at, last_bust_timestamp })) };
  }
  if (sql.startsWith('select last_bust_timestamp from users where id=')) {
    const user = state.users.find(u => u.id === params[0]);
    return { rows: user ? [{ last_bust_timestamp: user.last_bust_timestamp }] : [] };
  }

  if (sql.startsWith('insert into busts')) {
    const [user_id, timestamp, note, temp_f, pressure, lat, long, city, time_bucket] = params;
    const row = { id: randomUUID(), user_id, timestamp: new Date(timestamp).toISOString(), note, temp_f: maybeNumber(temp_f), pressure: maybeNumber(pressure), lat: maybeNumber(lat), long: maybeNumber(long), city, time_bucket };
    state.busts.push(row);
    return { rows: [clone(row)] };
  }
  if (sql.startsWith('update users set last_bust_timestamp=')) {
    const user = state.users.find(u => u.id === params[1]);
    if (user) user.last_bust_timestamp = new Date(params[0]).toISOString();
    return { rows: [] };
  }
  if (sql.includes('from busts b join users u') && sql.includes('where b.id=')) {
    return { rows: state.busts.filter(b => b.id === params[0]).map(bustJoined) };
  }
  if (sql.includes('from busts b join users u') && sql.includes('order by b.timestamp desc')) {
    return { rows: [...state.busts].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, params[0] || 300).map(bustJoined) };
  }

  if (sql.startsWith('insert into achievements')) {
    const [user_id, achievement_type] = params;
    const exists = state.achievements.some(a => a.user_id === user_id && a.achievement_type === achievement_type);
    if (!exists) state.achievements.push({ id: randomUUID(), user_id, achievement_type, unlocked_at: new Date().toISOString() });
    return { rows: [] };
  }
  if (sql.startsWith('select * from achievements')) {
    return { rows: [...state.achievements].sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at)).map(clone) };
  }

  throw new Error(`Unsupported memory query: ${String(text).slice(0, 160)}`);
}

export const pool = useMemory ? { query: memoryQuery, end: async () => {} } : new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
export async function query(text, params) { return pool.query(text, params); }
if (useMemory) console.warn('Using in-memory demo database. Set DATABASE_URL and omit DEMO_DB=1 for persistent PostgreSQL.');
