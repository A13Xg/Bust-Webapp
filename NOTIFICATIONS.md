# Notifications

How BUST gets a message onto someone's lock screen, what breaks, and how to tell
which part broke.

## What triggers a notification

| Event | Who receives it | Path |
| --- | --- | --- |
| Someone busts | Everyone except the buster | Web push (instant) + an in-app toast for anyone with the app open |
| Someone unlocks an achievement | Everyone except that user | Web push, at most one per unlocker per 10 min |
| No bust for 5-7 days | That user only | Web push, from the scheduled dispatcher |
| An admin sends a debug broadcast | **Everyone, including the sender** | Web push, on demand from the debug menu |

Every send is logged to `push_deliveries`, one row per recipient device, and the
service worker acknowledges the ones that arrive. The debug menu's DELIVERY tab
reads that back as totals plus a per-event log.

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

**One bust is worth one achievement push.** A single bust can unlock several
achievements at once, and re-reconciling mints a whole backlog — 13 in one
observed sweep, which the crew received as 13 separate notifications. Two
independent caps stop that, and both are needed:

1. The client announces only `pickAnnounceableUnlock(newlyPersisted)`, the single
   highest-XP unlock. Note this is *stricter* than `capUnlocksPerBust`, which
   still lets an achievement and a badge/trophy through for the on-screen toast.
2. `announceAchievement` claims a per-actor slot id in `push_events` before
   announcing, and declines when the slot is taken.

The server-side half is not belt-and-braces. Every row the client declines to
announce is still sitting in `achievements` inside `dispatch-push-backstop`'s
one-hour lookback, and the backstop would announce every one of them on its next
run. A client-only cap is silently undone within ten minutes.

**A suppressed announcement is still claimed.** Declining to push a row means
writing its `push_events` row anyway, with zero recipients — the same thing
`announceAchievement` does for an achievement id outside the catalog. Skip the
claim and the backstop re-evaluates that row on every run for the whole lookback
window, then announces it the moment the cooldown lapses. The cap becomes a
delay.

**The cooldown gate must be atomic.** `announceToCrew` is fire-and-forget, so a
client with several new achievements fires several `notify-event` requests
concurrently. A `select count(*)` check followed by a send is a race every one of
those callers wins. The gate is a `claimPushEvent` against the unique index on
`(kind, source_id)` instead, which is the same primitive that makes the ledger
exactly-once. A slot that is claimed and then fails to send is released along
with the row's own claim, or one transient failure would silence the whole
window and lock the backstop out of retrying.

**Busts are exempt from every cap.** A bust is news and must never be dropped as
collateral. `notify-event`'s 12-per-5-minute ceiling counts only
`kind = 'achievement'` and is only consulted for achievements; counting every
kind meant an achievement backlog could exhaust the budget and then throttle that
account's next real bust. Busts need no ceiling of their own — the
`enforce_bust_cooldown` trigger already allows one per two hours.

**A failed reminder is not retried.** `dispatch-inactivity-reminders` advances
the cycle on any attempt, delivered or not. Leaving a failed reminder due meant
it was re-sent on every run — every ten minutes — until `bump_push_failure`
evicted the subscription at 25 strikes, so a transient push-service outage cost
the user push entirely. Losing one nag out of a 5-7 day cycle is the cheaper
failure. The advance goes through `markInactivityReminderSent` so `lastSentAt` is
set and the next reconcile takes the follow-up-window branch; writing a bare
retry timestamp into `scheduledFor` does not work, because
`reconcileInactivityReminderState` rewrites any value outside the current window
back to "now" — which would have made the backoff hold for users scheduled early
in their window and silently fail for those scheduled late.

**"Delivered" from a push service is not delivered.** `webpush.sendNotification`
resolving means FCM/Mozilla/Apple accepted the message for onward delivery.
There is no delivery receipt in the web push protocol, so `last_success_at` and
`DeliveryResult.delivered` both systematically overstate what reached a device.
The only party that knows is the device: `sw.js` acknowledges each notification
to `ack-push`, which stamps `push_deliveries.acked_at`, and the debug menu's
DELIVERY tab reports sent-versus-received per event.

Read a missing acknowledgement as *unconfirmed*, never as undelivered. A device
that was offline, or whose worker the browser killed before the `fetch` landed,
shows unconfirmed with the notification sitting on its lock screen.

**`ack-push` is unauthenticated on purpose.** A service worker has no access to
the page's Supabase session, so there is no JWT to send. The per-delivery
`receipt_id` carried in the push payload is the entire authorisation: an
unguessable UUID granting exactly one capability, to set one row's `acked_at`.
It answers 204 whether or not the id existed, so it cannot be probed for valid
receipts, and the update is filtered on `acked_at is null` so a replay cannot
move a timestamp. The acknowledging `fetch` is also fire-and-forget inside a
`try/catch`: an unhandled rejection there would reject the push event's
`waitUntil` and cost the user the notification itself.

**The delivery log is written best-effort.** `sendToSubscriptions` inserts into
`push_deliveries` after the sends resolve, and only logs a failed insert. It is
observability; it must never turn a delivered notification into a failed
dispatch. That is also what makes the migration safe to apply after the deploy —
until the table exists, acks are dropped and the DELIVERY tab reports itself
unavailable, while push itself is unaffected.

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
  the `BROADCAST_ADMINS` secret is what stands between this function and a
  crew-wide spam cannon. It holds comma-separated SHA-256 hex digests, and it
  defaults to one digest so a deploy that forgets the secret fails closed to a
  single account rather than open to everyone.

  A digest may be of a **profile UUID** or of a **lower-cased username**, and
  they are not equally strong. A UUID cannot be changed — RLS pins `id` to
  `auth.uid()` — so it genuinely restricts who can broadcast. A username is
  obfuscation only: `profiles_update` lets any crew member rename their own
  row, the `unique` constraint on `username` is case-sensitive (so `alexg` and
  `AlexG` coexist), and usernames are world-readable, so an attacker can try
  each in turn. The username option is accepted deliberately for low friction;
  prefer the UUID. Generate either with:

  ```bash
  node -e "console.log(require('crypto').createHash('sha256').update('VALUE').digest('hex'))"
  ```
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

## How permission gets asked for

Two dialogs, with different jobs. Both live behind `src/permissionRequests.js`,
which classifies what happened.

**First login** — `PermissionsDialog`, three phases in one stretching window:
why → what to enable → what happened. Location is requested first, then
notifications, strictly one after the other; fire both at once and the browser
stacks or silently drops the second. Install is offered only after that panel is
dismissed, never alongside a native prompt, which also means `prompt()` gets a
fresh user gesture from the final OKAY — it would not survive two awaited
permission dialogs.

`Don't ask me again` lives in `localStorage` and nowhere else. That is not
laziness: localStorage is per origin per device, which is exactly the requested
behaviour (same device elsewhere → stays quiet; new device → asks again) with no
detection code. Storing it against the account would break it.

**Bust time** — the older `PermissionGate`, now firing during the charge phase
and only on a *confirmed* denial. It ignores the opt-out on purpose, and offers
no install step. `navigator.permissions.query` has no geolocation support on iOS
Safari, so there the location half can never be confirmed and never fires; an
unknown state is not a denial.

**Retry is offered only where asking again can change the answer.** A browser
prompts only while the state is undecided, so a denial is final until the user
edits site settings — a RETRY there would visibly do nothing. A dismissed prompt
(`default`) and a geolocation timeout or position-unavailable are all
recoverable, and those get the button. Everything else gets a red X and a
pointer at site settings.

## Admin actions

`BROADCAST_ADMINS` now gates two functions, and the check lives once in
`supabase/functions/_shared/adminAuth.ts` so the two cannot drift:

| Function | Power |
| --- | --- |
| `broadcast-test-notification` | Push arbitrary text to every registered device |
| `admin-set-password` | **Set any account's password without the old one** |

Be clear-eyed about the second: it is account takeover, strictly more powerful
than the broadcast, and the same single secret authorises both. Whoever is on
that list can seize any account in the crew. It logs every use with both the
actor and the target, and the service-role key never leaves the function.

Usernames became a safe thing to authorise on in
`migrations/20260908010000_username_case_insensitive.sql`: a unique index on
`lower(username)` makes `alexg` and `AlexG` one identity, and a trigger makes
usernames immutable. Before that, `profiles_update` let any crew member rename
themselves onto the allowlist. A digest of a profile UUID remains the stronger
option and is still accepted.

## Deploying

```bash
supabase link --project-ref <ref>
supabase db push --linked                       # migrations, in filename order
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... REMINDER_CRON_SECRET=...
supabase secrets set BROADCAST_ADMINS=<sha256-hex>    # who may crew-wide broadcast
supabase functions deploy register-push-subscription
supabase functions deploy notify-event
supabase functions deploy dispatch-push-backstop
supabase functions deploy dispatch-inactivity-reminders
supabase functions deploy broadcast-test-notification
supabase functions deploy admin-set-password
supabase functions deploy delete-account
supabase functions deploy ack-push
supabase functions deploy push-delivery-report
```

`deploy.yml` now deploys every function under `supabase/functions/` on a push to
`main`, so in practice only `supabase db push` is a manual step — **nothing in CI
or CD applies `supabase/migrations/`.** `npm run db:migrate` builds the local
Express dev schema (`server/schema.js`), not this directory.

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
they need Deno, configured by `supabase/functions/deno.json`. All of them run in CI.
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
