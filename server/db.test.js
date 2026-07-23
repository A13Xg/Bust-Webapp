/**
 * Tests for server-side cooldown enforcement and achievement validation
 * using the in-memory database mode.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Force memory mode for tests
process.env.DEMO_DB = '1';
delete process.env.DATABASE_URL;

// Import after setting env
const { query, withTransaction } = await import('./db.js');

// ── helpers ─────────────────────────────────────────────────────────────────
async function registerUser(username = 'tester') {
  // Directly insert via query to simulate registration
  const res = await query(
    'INSERT INTO users (username, synthetic_email, password_hash, avatar_seed) VALUES ($1,$2,$3,$4) RETURNING *',
    [username, `${username}@test.invalid`, 'hash', 'seed']
  );
  return res.rows[0];
}

async function resetDB() {
  await query('DROP TABLE IF EXISTS users', []);
  await query('DROP TABLE IF EXISTS busts', []);
  await query('DROP TABLE IF EXISTS achievements', []);
}

// ── cooldown enforcement ─────────────────────────────────────────────────────
describe('in-memory cooldown enforcement', () => {
  beforeEach(async () => {
    await resetDB();
  });

  it('allows bust when no previous bust exists', async () => {
    const user = await registerUser('alice');
    const res = await query(
      "SELECT id FROM users WHERE id=$1 AND (last_bust_timestamp IS NULL OR now() - last_bust_timestamp >= interval '2 hours') FOR UPDATE",
      [user.id]
    );
    expect(res.rows).toHaveLength(1);
  });

  it('blocks bust when cooldown is active', async () => {
    const user = await registerUser('bob');
    // Simulate a very recent bust by updating last_bust_timestamp to now
    await query('UPDATE users SET last_bust_timestamp=$1 WHERE id=$2', [new Date().toISOString(), user.id]);
    const res = await query(
      "SELECT id FROM users WHERE id=$1 AND (last_bust_timestamp IS NULL OR now() - last_bust_timestamp >= interval '2 hours') FOR UPDATE",
      [user.id]
    );
    expect(res.rows).toHaveLength(0);
  });

  it('allows bust when cooldown has expired (2h+)', async () => {
    const user = await registerUser('carol');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000 - 1000);
    await query('UPDATE users SET last_bust_timestamp=$1 WHERE id=$2', [twoHoursAgo.toISOString(), user.id]);
    const res = await query(
      "SELECT id FROM users WHERE id=$1 AND (last_bust_timestamp IS NULL OR now() - last_bust_timestamp >= interval '2 hours') FOR UPDATE",
      [user.id]
    );
    expect(res.rows).toHaveLength(1);
  });

  it('withTransaction executes callback and returns result in memory mode', async () => {
    const user = await registerUser('dave');
    const result = await withTransaction(async client => {
      return client.query('SELECT id FROM users WHERE id=$1', [user.id]);
    });
    expect(result.rows[0].id).toBe(user.id);
  });

  it('serializes concurrent in-memory transactions for cooldown checks', async () => {
    const user = await registerUser('ivan');
    const attempt = () =>
      withTransaction(async client => {
        const ok = await client.query(
          "SELECT id FROM users WHERE id=$1 AND (last_bust_timestamp IS NULL OR now() - last_bust_timestamp >= interval '2 hours') FOR UPDATE",
          [user.id]
        );
        if (!ok.rows.length) return false;
        await new Promise(resolve => setTimeout(resolve, 10));
        await client.query('UPDATE users SET last_bust_timestamp=$1 WHERE id=$2', [new Date().toISOString(), user.id]);
        return true;
      });
    const [a, b] = await Promise.all([attempt(), attempt()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

// ── achievement persistence ───────────────────────────────────────────────────
describe('in-memory achievement persistence', () => {
  beforeEach(async () => {
    await resetDB();
  });

  it('inserts a new achievement', async () => {
    const user = await registerUser('eve');
    await query('INSERT INTO achievements (user_id, achievement_type) VALUES ($1,$2)', [user.id, 'first_release']);
    const res = await query('SELECT * FROM achievements WHERE user_id=$1', [user.id]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].achievement_type).toBe('first_release');
  });

  it('does not duplicate achievements (idempotent insert)', async () => {
    const user = await registerUser('frank');
    await query('INSERT INTO achievements (user_id, achievement_type) VALUES ($1,$2)', [user.id, 'first_release']);
    await query('INSERT INTO achievements (user_id, achievement_type) VALUES ($1,$2)', [user.id, 'first_release']);
    const res = await query('SELECT * FROM achievements WHERE user_id=$1', [user.id]);
    expect(res.rows).toHaveLength(1);
  });

  it('returns achievements ordered by unlocked_at descending', async () => {
    const user = await registerUser('grace');
    await query('INSERT INTO achievements (user_id, achievement_type) VALUES ($1,$2)', [user.id, 'first_release']);
    await query('INSERT INTO achievements (user_id, achievement_type) VALUES ($1,$2)', [user.id, 'hat_trick']);
    const res = await query('SELECT * FROM achievements WHERE user_id=$1', [user.id]);
    expect(res.rows).toHaveLength(2);
    // Most recently unlocked first
    const times = res.rows.map(r => new Date(r.unlocked_at).getTime());
    expect(times[0]).toBeGreaterThanOrEqual(times[1]);
  });

  it('deletes achievements when user is deleted', async () => {
    const user = await registerUser('heidi');
    await query('INSERT INTO achievements (user_id, achievement_type) VALUES ($1,$2)', [user.id, 'first_release']);
    await query('DELETE FROM users WHERE id=$1', [user.id]);
    const res = await query('SELECT * FROM achievements WHERE user_id=$1', [user.id]);
    expect(res.rows).toHaveLength(0);
  });
});
