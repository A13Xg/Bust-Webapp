import { assertEquals } from 'jsr:@std/assert@^1';
import { announceAchievement } from './announce.ts';

/*
 * Both branches exercised here return before ever calling
 * subscriptionsForCrew/sendToSubscriptions, so a fake push_events table is
 * enough — no real web-push send is involved.
 */
function fakePushEventsAdmin(
  claimResults: Array<{ data: { id: number } | null; error: { code?: string; message?: string } | null }>,
) {
  let insertCalls = 0;
  return {
    from: (table: string) => {
      if (table === 'discord_settings') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      return ({
        insert: () => {
          const result = claimResults[insertCalls] ?? claimResults[claimResults.length - 1];
          insertCalls += 1;
          return { select: () => ({ maybeSingle: () => Promise.resolve(result) }) };
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      });
    },
  };
}

Deno.test('announceAchievement claims but does not push an id outside the catalog', async () => {
  const admin = fakePushEventsAdmin([{ data: { id: 1 }, error: null }]);
  const outcome = await announceAchievement(admin as unknown as Parameters<typeof announceAchievement>[0], {
    id: 'ach-row-1',
    user_id: 'user-1',
    achievement_type: 'not-a-real-achievement',
  });
  assertEquals(outcome.status, 'unknown');
});

Deno.test('announceAchievement suppresses a second unlock inside the same cooldown slot', async () => {
  // First insert is the per-actor cooldown slot claim — 23505 means someone
  // else (or an earlier unlock in this same burst) already holds it. Second
  // insert is claimWithoutSending's claim of this row itself, which must
  // still succeed so the backstop never re-evaluates it.
  const admin = fakePushEventsAdmin([
    { data: null, error: { code: '23505', message: 'duplicate key' } },
    { data: { id: 2 }, error: null },
  ]);
  const outcome = await announceAchievement(admin as unknown as Parameters<typeof announceAchievement>[0], {
    id: 'ach-row-2',
    user_id: 'user-1',
    achievement_type: 'first_release',
  }, 'test-user');
  assertEquals(outcome.status, 'suppressed');
});
