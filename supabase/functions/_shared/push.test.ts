import { assertEquals, assertRejects } from 'jsr:@std/assert@^1';
import {
  authorizeCron,
  claimPushEvent,
  finishPushEvent,
  isGoneError,
  releasePushEvent,
  secretsMatch,
  subscriptionsForCrew,
} from './push.ts';

/*
 * Hand-rolled fake Supabase clients, matching this repo's existing test style
 * (src/fetchAllPages.test.js's vi.fn() returning { data, error }) rather than
 * a mocking library. A PostgREST builder is thenable, so the stub resolves on
 * `await` regardless of how many chain methods ran first.
 */
function queryStub(rows: unknown[], error: { code?: string; message?: string } | null = null) {
  const calls: { method: string; args: unknown[] }[] = [];
  const stub: Record<string, unknown> = {};
  const chain = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    return stub;
  };
  stub.select = chain('select');
  stub.range = chain('range');
  stub.neq = chain('neq');
  stub.in = chain('in');
  stub.eq = chain('eq');
  stub.then = (resolve: (value: { data: unknown[]; error: typeof error }) => unknown) => resolve({ data: rows, error });
  return { stub, calls };
}

Deno.test('isGoneError classifies 404/410 as gone and everything else as not', () => {
  assertEquals(isGoneError({ statusCode: 404 }), true);
  assertEquals(isGoneError({ statusCode: 410 }), true);
  assertEquals(isGoneError({ statusCode: 403 }), false);
  assertEquals(isGoneError({ statusCode: 500 }), false);
  assertEquals(isGoneError(new Error('boom')), false);
});

Deno.test('secretsMatch requires both sides non-empty and equal', () => {
  assertEquals(secretsMatch('shared-secret', 'shared-secret'), true);
  assertEquals(secretsMatch('shared-secret', 'wrong'), false);
  assertEquals(secretsMatch('', ''), false);
  assertEquals(secretsMatch(null, null), false);
  assertEquals(secretsMatch('shared-secret', null), false);
});

Deno.test('authorizeCron accepts a matching x-cron-secret header', () => {
  Deno.env.set('REMINDER_CRON_SECRET', 'top-secret');
  try {
    const req = new Request('https://example.com', { headers: { 'x-cron-secret': 'top-secret' } });
    assertEquals(authorizeCron(req, 'service-role-key'), true);
  } finally {
    Deno.env.delete('REMINDER_CRON_SECRET');
  }
});

Deno.test('authorizeCron accepts a matching service-role bearer token when no cron secret is configured', () => {
  Deno.env.delete('REMINDER_CRON_SECRET');
  const req = new Request('https://example.com', { headers: { Authorization: 'Bearer service-role-key' } });
  assertEquals(authorizeCron(req, 'service-role-key'), true);
});

Deno.test('authorizeCron rejects mismatched or missing credentials', () => {
  Deno.env.delete('REMINDER_CRON_SECRET');
  const req = new Request('https://example.com', { headers: { Authorization: 'Bearer someone-else' } });
  assertEquals(authorizeCron(req, 'service-role-key'), false);
});

Deno.test('claimPushEvent returns the new row id on a successful claim', async () => {
  const admin = {
    from: () => ({
      insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 42 }, error: null }) }) }),
    }),
  };
  const id = await claimPushEvent(
    admin as unknown as Parameters<typeof claimPushEvent>[0],
    'bust',
    'source-1',
    'actor-1',
  );
  assertEquals(id, 42);
});

Deno.test('claimPushEvent returns null when another caller already holds the claim (23505)', async () => {
  const admin = {
    from: () => ({
      insert: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }),
        }),
      }),
    }),
  };
  const id = await claimPushEvent(
    admin as unknown as Parameters<typeof claimPushEvent>[0],
    'bust',
    'source-1',
    'actor-1',
  );
  assertEquals(id, null);
});

Deno.test('claimPushEvent throws on a real (non-duplicate) database error', async () => {
  const admin = {
    from: () => ({
      insert: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } }),
        }),
      }),
    }),
  };
  await assertRejects(
    () => claimPushEvent(admin as unknown as Parameters<typeof claimPushEvent>[0], 'bust', 'source-1', 'actor-1'),
    Error,
    'permission denied',
  );
});

Deno.test('releasePushEvent deletes the claimed row by id', async () => {
  const calls: unknown[] = [];
  const admin = {
    from: (table: string) => ({
      delete: () => ({
        eq: (column: string, value: unknown) => {
          calls.push({ table, column, value });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  await releasePushEvent(admin as unknown as Parameters<typeof releasePushEvent>[0], 7);
  assertEquals(calls, [{ table: 'push_events', column: 'id', value: 7 }]);
});

Deno.test('finishPushEvent records dispatch counts on the claimed row', async () => {
  const calls: unknown[] = [];
  const admin = {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (column: string, value: unknown) => {
          calls.push({ table, patch, column, value });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  await finishPushEvent(admin as unknown as Parameters<typeof finishPushEvent>[0], 7, {
    attempted: 3,
    delivered: 2,
    pruned: 1,
    failures: [],
  });
  assertEquals(calls.length, 1);
  const [{ table, patch, column, value }] = calls as [
    { table: string; patch: Record<string, unknown>; column: string; value: unknown },
  ];
  assertEquals(table, 'push_events');
  assertEquals(column, 'id');
  assertEquals(value, 7);
  assertEquals(patch.recipients, 3);
  assertEquals(patch.delivered, 2);
});

Deno.test('subscriptionsForCrew excludes the acting user via neq', async () => {
  const { stub, calls } = queryStub([]);
  const admin = { from: () => stub };
  await subscriptionsForCrew(admin as unknown as Parameters<typeof subscriptionsForCrew>[0], 'actor-1', null);
  assertEquals(
    calls.some((call) => call.method === 'neq' && call.args[0] === 'user_id' && call.args[1] === 'actor-1'),
    true,
  );
  assertEquals(calls.some((call) => call.method === 'in'), false);
});

Deno.test('subscriptionsForCrew scopes to explicit target ids via in', async () => {
  const { stub, calls } = queryStub([]);
  const admin = { from: () => stub };
  await subscriptionsForCrew(admin as unknown as Parameters<typeof subscriptionsForCrew>[0], null, [
    'user-a',
    'user-b',
  ]);
  assertEquals(
    calls.some((call) =>
      call.method === 'in' && call.args[0] === 'user_id' && Array.isArray(call.args[1]) &&
      (call.args[1] as string[]).length === 2
    ),
    true,
  );
});

Deno.test('subscriptionsForCrew matches nobody for an empty target list rather than everybody', async () => {
  const { stub, calls } = queryStub([]);
  const admin = { from: () => stub };
  await subscriptionsForCrew(admin as unknown as Parameters<typeof subscriptionsForCrew>[0], null, []);
  // An empty allow-list must not silently fall through to "no filter at all" —
  // ['user_id', ['']] is the sentinel that matches zero real rows.
  assertEquals(
    calls.some((call) =>
      call.method === 'in' && Array.isArray(call.args[1]) && (call.args[1] as string[]).length === 1 &&
      (call.args[1] as string[])[0] === ''
    ),
    true,
  );
});
