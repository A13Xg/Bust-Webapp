import { strict as assert } from 'node:assert';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { dispatchRecentEvents } from './backstop.ts';
import { announceBust } from './announce.ts';
import { DEFAULT_DISCORD_SETTINGS, maskWebhookUrl, validateDiscordSettingsPatch } from './discord.ts';

const occurredAt = '2026-09-30T12:00:00.000Z';
const bust = { id: 'b1', user_id: 'u1', timestamp: occurredAt, note: 'hello', city: 'Austin' };
const achievement = { id: 'a1', user_id: 'u1', unlocked_at: occurredAt, achievement_type: 'first_release' };

// Stateful PostgREST fake: exercise the real sweep, announcement, ledger, and
// transport code together, while keeping all I/O inside the test process.
function database(seed: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = {
    busts: [bust],
    achievements: [achievement],
    profiles: [{ id: 'u1', username: 'Alex' }],
    discord_settings: [
      {
        ...DEFAULT_DISCORD_SETTINGS,
        id: 1,
        enabled: true,
        webhook_url: 'https://discord.com/api/webhooks/123/test-token',
      },
    ],
    push_events: [],
    discord_events: [],
    push_subscriptions: [],
    push_deliveries: [],
    ...seed,
  };
  let nextId = 100;
  const admin = {
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      let operation = 'select';
      let patch: any;
      let single = false;
      let limit = Infinity;
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return query;
        },
        neq(key: string, value: unknown) {
          filters.push((row) => row[key] !== value);
          return query;
        },
        in(key: string, values: unknown[]) {
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        gte(key: string, value: string) {
          filters.push((row) => row[key] >= value);
          return query;
        },
        lte(key: string, value: string) {
          filters.push((row) => row[key] <= value);
          return query;
        },
        order() {
          return query;
        },
        limit(value: number) {
          limit = value;
          return query;
        },
        range() {
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        insert(value: any) {
          operation = 'insert';
          patch = value;
          return query;
        },
        update(value: any) {
          operation = 'update';
          patch = value;
          return query;
        },
        delete() {
          operation = 'delete';
          return query;
        },
        then(resolve: (value: any) => unknown) {
          const rows = tables[table];
          assert.ok(rows, `Unexpected table ${table}`);
          let selected = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, limit);
          if (operation === 'insert') {
            const inserts = Array.isArray(patch) ? patch : [patch];
            if (
              table.endsWith('_events') &&
              inserts.some((item) => rows.some((row) => row.kind === item.kind && row.source_id === item.source_id))
            ) {
              return resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
            }
            selected = inserts.map((item) => ({ id: nextId++, created_at: occurredAt, ...item }));
            rows.push(...selected);
          }
          if (operation === 'update') selected.forEach((row) => Object.assign(row, patch));
          if (operation === 'delete') tables[table] = rows.filter((row) => !selected.includes(row));
          return resolve({ data: single ? (selected[0] ?? null) : selected, error: null });
        },
      };
      return query;
    },
    rpc() {
      return Promise.resolve({ data: 0, error: null });
    },
  };
  return { admin: admin as unknown as SupabaseClient, tables };
}

async function withTransports(run: (sent: any[], failDiscord: (value: boolean) => void) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const previousSend = webpush.sendNotification;
  const previousConfigure = webpush.setVapidDetails;
  const env = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].map((key) => [key, Deno.env.get(key)] as const);
  const sent: any[] = [];
  let failing = false;
  globalThis.fetch = (_url, init) => {
    assert.ok(init?.signal, 'Webhook requests must have a timeout signal');
    sent.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response(failing ? 'Unavailable' : '{}', { status: failing ? 503 : 200 }));
  };
  console.error = () => {};
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = () => Promise.reject(Object.assign(new Error('temporary failure'), { statusCode: 503 }));
  Deno.env.set('VAPID_PUBLIC_KEY', 'test');
  Deno.env.set('VAPID_PRIVATE_KEY', 'test');
  try {
    await run(sent, (value) => {
      failing = value;
    });
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
    webpush.sendNotification = previousSend;
    webpush.setVapidDetails = previousConfigure;
    for (const [key, value] of env) {
      if (value == null) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test('backstop delivers push-handled busts and suppressed achievements to Discord only once', async () => {
  await withTransports(async (sent) => {
    const { admin, tables } = database({
      push_events: [
        { id: 1, kind: 'bust', source_id: 'b1' },
        { id: 2, kind: 'achievement', source_id: 'a1' },
      ],
    });
    await dispatchRecentEvents(admin, '2026-09-30T11:00:00Z');
    assert.equal(sent.length, 2);
    assert.ok(sent.every((payload) => payload.embeds[0].timestamp === occurredAt));
    assert.equal(tables.push_events.length, 2, 'Discord-only retries must not reserve push slots');
    assert.equal(tables.discord_events.length, 2);
    await dispatchRecentEvents(admin, '2026-09-30T11:00:00Z');
    assert.equal(sent.length, 2);
  });
});

Deno.test('failed Discord send is retried by backstop after push was already handled', async () => {
  await withTransports(async (sent, failDiscord) => {
    const { admin, tables } = database({ achievements: [] });
    failDiscord(true);
    await announceBust(admin, bust, 'Alex');
    assert.equal(tables.push_events.length, 1);
    assert.equal(tables.discord_events.length, 0, 'failed send must release its claim');
    failDiscord(false);
    await dispatchRecentEvents(admin, '2026-09-30T11:00:00Z');
    assert.equal(sent.length, 2);
    assert.equal(tables.discord_events[0].success, true);
  });
});

Deno.test('all-failed push releases its claim while a successful Discord send stays deduplicated', async () => {
  await withTransports(async (sent) => {
    const { admin, tables } = database({
      achievements: [],
      push_subscriptions: [{ id: 1, user_id: 'u2', endpoint: 'https://example.invalid', p256dh: 'test', auth: 'test' }],
    });
    const outcome = await announceBust(admin, bust, 'Alex');
    assert.equal(outcome.status, 'failed');
    assert.equal(tables.push_events.length, 0);
    assert.equal(tables.discord_events.length, 1);
    await dispatchRecentEvents(admin, '2026-09-30T11:00:00Z');
    assert.equal(sent.length, 1);
  });
});

Deno.test('disabled Discord does not create Discord claims or HTTP requests', async () => {
  await withTransports(async (sent) => {
    const { admin, tables } = database({ discord_settings: [{ id: 1, ...DEFAULT_DISCORD_SETTINGS }] });
    await dispatchRecentEvents(admin, '2026-09-30T11:00:00Z');
    assert.equal(sent.length, 0);
    assert.equal(tables.discord_events.length, 0);
  });
});

Deno.test('Discord settings reject malformed webhooks and mask tokens', () => {
  assert.equal(validateDiscordSettingsPatch({ webhook_url: 'https://example.com/private' }).ok, false);
  assert.equal(validateDiscordSettingsPatch({ enabled: 'true' }).ok, false);
  assert.equal(validateDiscordSettingsPatch({ bot_avatar_url: 'javascript:alert(1)' }).ok, false);
  assert.equal(validateDiscordSettingsPatch({ footer_text: 'x'.repeat(2049) }).ok, false);
  assert.equal(validateDiscordSettingsPatch({ webhook_url: 'https://discord.com/api/webhooks/123/secret' }).ok, true);
  assert.ok(!maskWebhookUrl('https://discord.com/api/webhooks/123/secret')?.includes('secret'));
});

Deno.test('backstop advances past the newest 50 handled achievements on the next sweep', async () => {
  await withTransports(async (sent) => {
    const achievements = Array.from({ length: 60 }, (_, index) => ({ ...achievement, id: `a${index}` }));
    const { admin, tables } = database({
      busts: [],
      achievements,
      push_events: achievements.map((row, id) => ({ id, kind: 'achievement', source_id: row.id })),
    });
    await dispatchRecentEvents(admin, '2026-09-30T11:00:00Z');
    assert.equal(sent.length, 50);
    await dispatchRecentEvents(admin, '2026-09-30T11:00:00Z');
    assert.equal(sent.length, 60);
    assert.equal(tables.discord_events.length, 60);
  });
});
