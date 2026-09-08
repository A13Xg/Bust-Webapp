# Notifications

How BUST gets a message onto someone's lock screen, what breaks, and how to tell
which part broke.

## What triggers a notification

| Event | Who receives it | Path |
| --- | --- | --- |
| Someone busts | Everyone except the buster | Web push (instant) + an in-app toast for anyone with the app open |
| Someone unlocks an achievement | Everyone except that user | Web push |
| No bust for 5-7 days | That user only | Web push, from the scheduled dispatcher |

Reminder timing is randomized per user inside a 5-7 day window measured from
their last bust, so the crew is never nagged in lockstep. Any bust resets the
cycle. Copy for all three lives in `src/notificationMessages.js`.

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

**One endpoint, one account.** `push_subscriptions` has a unique index on
`endpoint`, and `register-push-subscription` deletes any other account's claim on
the same endpoint. Without that, two people sharing a browser receive each
other's notifications.

## Deploying

```bash
supabase link --project-ref <ref>
supabase db push --linked                       # migrations, in filename order
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... REMINDER_CRON_SECRET=...
supabase functions deploy register-push-subscription
supabase functions deploy notify-event
supabase functions deploy dispatch-push-backstop
supabase functions deploy dispatch-inactivity-reminders
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

## Verifying VAPID credentials

A 404/410 from a push service for a synthetic endpoint means the request was
signed and accepted. A 401/403 means the credentials are wrong.
