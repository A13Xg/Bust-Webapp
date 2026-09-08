# Notifications

How BUST gets a message onto someone's lock screen, what breaks, and how to tell
which part broke.

## What triggers a notification

| Event | Who receives it | Path |
| --- | --- | --- |
| Someone busts | Everyone except the buster | Web push (instant) + an in-app toast for anyone with the app open |
| Someone unlocks an achievement | Everyone except that user | Web push |
| No bust for 5-7 days | That user only | Web push, from the scheduled dispatcher |
| An admin sends a debug broadcast | **Everyone, including the sender** | Web push, on demand from the debug menu |

Reminder timing is randomized per user inside a 5-7 day window measured from
their last bust, so the crew is never nagged in lockstep. Any bust resets the
cycle. Copy for the first three lives in `src/notificationMessages.js`; broadcast copy is
typed by hand and rendered by `src/broadcastTemplate.js`.

## Architecture

```
browser                    Supabase                       GitHub Actions
───────                    ────────                       ──────────────
bust committed
  └─ notify-event ───────► verifies caller owns the row
                           claims push_events (kind, source_id)   ← exactly-once
                           web-push ──► FCM / Mozilla / Apple ──► every other device

                           dispatch-push-backstop  ◄─── notify-cron.yml (*/10)
                             re-sends anything notify-event lost

                           dispatch-inactivity-reminders ◄─── notify-cron.yml
                             sends the 5-7 day nag
```

`push_events` has a unique `(kind, source_id)`. Both the instant path and the
backstop insert into it before sending, so whichever gets there first sends and
the other one no-ops. That is what makes the backstop safe to run every ten
minutes.

## Rules that are easy to get wrong

**Never use `new Notification()`.** It throws `Illegal constructor` on Android
Chrome and does not exist inside an iOS home-screen web app. Everything goes
through `ServiceWorkerRegistration.showNotification()`; `src/notifications.js`
keeps the constructor only as a desktop fallback when no worker is available.

**iOS requires installation.** Safari on iOS exposes `Notification` and
`PushManager` only inside a PWA launched from the Home Screen (iOS 16.4+). Until
then the app reports `ios-needs-install` and tells the user to add it, rather
than showing a generic failure.

**Subscriptions rotate silently.** Browsers expire, rotate and evict push
subscriptions with no error to the page — historically the reason push here
"worked once and then never again". Three defences:

1. The app re-registers its current endpoint on every launch and whenever the tab
   returns to the foreground (`rearmPushSilently`).
2. The service worker handles `pushsubscriptionchange`, re-subscribes, and hands
   the new endpoint to any open tab.
3. `subscriptionKeyMismatch()` unsubscribes and re-subscribes when the stored
   subscription was created with a different VAPID key than the current build.

**The VAPID public key must match on both sides.** `VITE_WEB_PUSH_PUBLIC_KEY`
(browser build) and `VAPID_PUBLIC_KEY` (Edge Function secret) must be identical.
If they diverge, every push is signed with a key the subscription was not created
for and the push service drops it. `deploy.yml` fails the build if the browser
key is missing entirely.

**Compare instants, never timestamp strings.** Postgres serialises `timestamptz`
as `2026-08-25T12:00:00.123456+00:00`; `Date#toISOString()` produces
`2026-08-25T12:00:00.123Z`. A string comparison between the two is false for
every row read back from the database. `reconcileInactivityReminderState` used to
do exactly that, which discarded `lastSentAt` on every dispatch and re-fired the
reminder — 144 pushes a day per lapsed user at a 10-minute cadence. Anything
comparing a stored timestamp goes through `toEpochMs()`.

**A claim is released if delivery fails.** `push_events` is what stops two
callers announcing the same row, so holding a claim after a failed send would
suppress that notification permanently — the backstop would see the row and skip
it forever. `announce()` deletes the claim on any error so the sweep can retry.

**`startMessages()` is required.** The `ServiceWorkerContainer` message queue
only starts implicitly when an `onmessage` property is assigned. With
`addEventListener` alone, everything the worker posts is queued and never
delivered, including subscription-rotation handoffs.

**One endpoint, one account.** `push_subscriptions` has a unique index on
`endpoint`, and `register-push-subscription` upserts with `onConflict: 'endpoint'`
so a shared browser or an account switch transfers the row to the new owner in a
single statement. Without that, two people sharing a browser receive each other's
notifications — and a delete-then-insert would leave a window where a concurrent
registration hits the unique index and 500s.

That upsert UPDATEs the existing row, so any column it must not inherit has to be
in the payload explicitly. `failure_count` is reset there for that reason;
`last_success_at` is deliberately left alone as the record of the last real
delivery. It also means the index above is load-bearing: drop it and every
registration fails with `42P10`.

## Debug broadcast

`broadcast-test-notification` is the one path that can push arbitrary text to
every registered device. It exists for testing delivery on real hardware, and is
reachable only from the debug menu's NOTIFY tab (long-press or right-click
DELETE ACCOUNT), behind a confirmation dialog.

Two things about it differ from every other push path, both deliberate:

- **An allowlist is the only authorisation.** `notify-event` can safely admit
  any authenticated caller because it only announces a row that caller already
  owns. There is no ownership check available here — free text is the point — so
  the `BROADCAST_ADMINS` secret (comma-separated usernames and/or profile UUIDs)
  is what stands between this function and a crew-wide spam cannon. It defaults
  to `AlexG`, so a deploy that forgets the secret fails closed to one account
  rather than open to everyone. Keep the list short.
- **It does not use the `push_events` ledger.** The ledger makes a bust announce
  exactly once; a test send has no row behind it and is something you may
  legitimately want to repeat. (`push_events.kind` is also constrained to
  `'bust' | 'achievement'`, so a broadcast could not be recorded there without a
  migration.) Consequence: there is no dedupe and no backstop retry — a
  broadcast that fails is simply not delivered, which is the right trade for a
  manual test.

Templates render **per recipient**, so `{{USER}}` names each person on their own
device. That is why `sendToSubscriptions` accepts a payload *function* as well as
a payload object. Tokens are documented in `describeTokens()` and shown in the
tab itself. An unrecognised token renders literally rather than blanking, so a
typo is visible in the preview instead of shipping an empty sentence.

## Deploying

```bash
supabase link --project-ref <ref>
supabase db push --linked                       # migrations, in filename order
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... REMINDER_CRON_SECRET=...
supabase secrets set BROADCAST_ADMINS=AlexG           # who may crew-wide broadcast
supabase functions deploy register-push-subscription
supabase functions deploy notify-event
supabase functions deploy dispatch-push-backstop
supabase functions deploy dispatch-inactivity-reminders
supabase functions deploy broadcast-test-notification
```

Repository secrets required by `.github/workflows/notify-cron.yml`:

| Secret | Value |
| --- | --- |
| `SUPABASE_FUNCTIONS_URL` | `https://<ref>.supabase.co/functions/v1` |
| `REMINDER_CRON_SECRET` | must equal the Supabase function secret of the same name |
| `VITE_WEB_PUSH_PUBLIC_KEY` | the VAPID public key, for the Pages build |

## Diagnosing a device that gets nothing

1. **Profile → SEND TEST PING.** This arms push and asks the server to deliver to
   the endpoint it just stored. It exercises VAPID signing, the push service and
   the service worker in one round trip, and reports the actual failure text.
2. **Read the message, not the permission state.** Every failure mode has its own
   string (`ios-needs-install`, `no-vapid-key`, `register-failed`, …). A green
   permission toggle never implies a stored subscription.
3. **Check the dispatchers.** Actions → *Notification dispatch* → *Run workflow*.
   Both endpoints return a JSON summary of what they sent.
4. **Check the ledger.** `push_events` rows show `recipients` and `delivered`
   per event; `push_subscriptions.last_success_at` shows the last device that
   actually took a push.
5. **OS-level settings.** macOS Focus modes, Windows Focus Assist and per-site
   notification settings all suppress delivery after the browser has accepted it.

## Checks

| Command | Covers |
| --- | --- |
| `npm run lint` | `src/`, `server/`, `scripts/`, `public/sw.js` (eslint) |
| `npm run typecheck` | the browser app (`tsc --noEmit`) |
| `npm run lint:functions` | `supabase/functions/` (`deno lint`) |
| `npm run typecheck:functions` | `supabase/functions/` (`deno check`, strict) |
| `npm test` | vitest |

The Edge Functions are Deno TypeScript, so eslint and `tsc` cannot see them —
they need Deno, configured by `supabase/functions/deno.json`. All six run in CI.
That config is used only for checking; it does not change what
`supabase functions deploy` uploads (verified by redeploying an unmodified
function and confirming an identical bundle hash).

Because the functions type-check under `strict`, the shared modules they import
from `src/` carry JSDoc annotations. Those are load-bearing: drop them and the
callbacks in `fetchAllPages` land as implicit `any` and the check fails. Note
that a PostgREST builder is a *thenable*, not a `Promise`, so callback types must
be `PromiseLike`.

Still not covered: nothing executes the Edge Functions in CI. Type-checking will
not catch a wrong table name or a broken RLS assumption, so exercise the smoke
calls above after any change.

## Verifying VAPID credentials

A 404/410 from a push service for a synthetic endpoint means the request was
signed and accepted. A 401/403 means the credentials are wrong.
