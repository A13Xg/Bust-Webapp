# BUST — project brief

Everything an agent needs before touching this repo. Read this instead of
crawling the tree.

---

## 1. What this is

A private, mobile-first, satirical "pressure logging" app for a crew of about
seven friends. You press a giant button, watch an explosion animation, optionally
attach a note, and the rest of the crew is notified. There is a two-hour cooldown,
an XP/level system, and 132 achievements.

It is deliberately not a serious application. **Security has been traded for
convenience on purpose** — the invite code is in the client bundle, usernames are
world-readable, and the admin allowlist can be satisfied by a username digest.
There is no sensitive data. Do not "fix" these unless asked; do not add new holes
either.

Live at `https://a13xg.github.io/Bust-Webapp/`. Supabase project ref
`yuorggekucycvxrtqvvp`.

---

## 2. Two backends, one client

`src/backend.js` picks one at build time and everything else is written against
its interface.

| Mode | When | Auth | Data | Realtime |
| --- | --- | --- | --- | --- |
| **Static** (production) | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` present at build | Supabase Auth, synthetic emails (`alexg@bust-ops.dev`) | Postgres via PostgREST + RLS | Supabase Realtime |
| **Server** (local dev only) | otherwise | JWT from `server/index.js` | `server/db.js` + `pg` | WebSocket |

The two have **separate account stores** — static mode uses `profiles`, server
mode uses `users`. They never share data.

In practice `.env` sets the Supabase vars, so `npm run dev` also runs static
mode. The Express server is effectively dead weight kept alive by
`npm run db:migrate` / `npm run db:check` in CI. Removing it is a reasonable
future cleanup; it is not wired to anything the crew uses.

---

## 3. Data model

Live schema, `public`. Defined entirely by `supabase/migrations/` — **there is no
`setup.sql` any more**, and migrations are the single source of truth.

| Table | Purpose | RLS |
| --- | --- | --- |
| `profiles` | one row per account, FK to `auth.users` | select all; insert/update own |
| `busts` | the log; carries weather, coords, elevation, tide, BTC price | select all; insert own (+cooldown); update own note |
| `achievements` | unique `(user_id, achievement_type)`, FK to catalog | **select only** — no insert policy, on purpose |
| `achievement_catalog` | the 132 valid ids; FK target | RLS on, no policies → service role only |
| `push_subscriptions` | one row per browser endpoint, unique on `endpoint` | own rows only |
| `push_events` | the exactly-once ledger, unique `(kind, source_id)` | RLS on, no policies |
| `push_deliveries` | one row per recipient device per send | RLS on, no policies |
| `inactivity_reminders` | the 5–7 day nag cycle, one row per user | RLS on, no policies |

**RLS on with zero policies means total denial for `anon` and `authenticated`.**
The service role bypasses RLS, so those tables are Edge-Function-only. That is
intentional, not an oversight.

### Functions and triggers

| Object | Job |
| --- | --- |
| `enforce_bust_cooldown()` → `bust_cooldown_trigger` BEFORE INSERT on busts | the real cooldown. Takes `for update` on the profile row so two concurrent inserts cannot both win, overwrites the client's timestamp with `clock_timestamp()`, and maintains `profiles.last_bust_timestamp`. The RLS `busts_insert` check is only a cheap first line. |
| `reset_inactivity_reminder_on_bust()` → AFTER INSERT on busts | resets the nag cycle |
| `block_username_change()` → BEFORE UPDATE on profiles | usernames are immutable; with the unique index on `lower(username)` this makes one name one identity |
| `bump_push_failure(ids)` | counts non-gone send failures, drops an endpoint at 25 |
| `mark_push_sent(ids)` | +1 unacked, per endpoint |
| `record_push_ack(receipt)` | stamps the delivery **and** credits the endpoint as alive |
| `prune_dead_push_subscriptions(...)` | removes endpoints that provably never deliver |
| `push_subscription_health()` | per-endpoint sent/acked report |

Two functions were **deleted** in `20260913010000`: `on_bust_insert()` (orphaned,
no trigger used it) and `reconcile_achievements()` (a second, drifting SQL copy of
the achievement rules that also returned every user's rows).

---

## 4. Notifications — the part that keeps breaking

### Who gets what

| Event | Recipients | Path |
| --- | --- | --- |
| Someone busts | everyone **except** the buster | web push, instant, plus an in-app toast |
| Someone unlocks an achievement | everyone **except** them | web push, **exactly one per bust** |
| No bust for 5–7 days | that user only | web push from the scheduled dispatcher |
| Admin debug broadcast | whoever is targeted, sender included | web push, on demand |
| Test ping | **only the device that asked for it** | web push, scoped to one endpoint |

### Flow

```
browser                      Supabase                     GitHub Actions
───────                      ────────                     ──────────────
bust committed
  └─ notify-event ─────────► verifies caller owns the row
                             claims push_events (kind, source_id)  ← exactly-once
                             web-push ─► FCM / Mozilla / Apple ─► every other device

                             dispatch-push-backstop  ◄── notify-cron.yml (*/10)
                               re-sends anything notify-event lost
                               prunes provably dead endpoints

                             dispatch-inactivity-reminders ◄── notify-cron.yml
```

`push_events` has a unique `(kind, source_id)`. Both the instant path and the
backstop insert before sending, so whichever arrives first sends and the other
no-ops. That is what makes a ten-minute backstop safe.

### Rules that are easy to get wrong

**Never use `new Notification()`.** It throws `Illegal constructor` on Android
Chrome and does not exist inside an iOS home-screen app. Everything goes through
`ServiceWorkerRegistration.showNotification()`; the constructor survives only as
a desktop fallback when no worker exists.

**A silently-dead endpoint is invisible to every obvious check.** This is what
killed iOS push. Apple invalidates a Web Push subscription without telling
anyone: APNs keeps answering **201**, so `isGoneError` (404/410) never fires and
`bump_push_failure` records no strike. The browser is no help either —
`getSubscription()` still returns a `PushSubscription` whose VAPID key matches, so
`subscriptionKeyMismatch()` says fine and the app re-registers the same dead
endpoint on every launch, forever. Observed: one iPhone holding three
`web.push.apple.com` rows, all returning 201, only the newest rendering anything.

The **only** signal that separates a live endpoint from a ghost is the device's
acknowledgement. Hence: `push_deliveries.subscription_id` ties an ack to an
endpoint, `mark_push_sent` counts accepted-but-unconfirmed sends,
`record_push_ack` clears the counter, the client rotates its endpoint once
`shouldRotateEndpoint()` is satisfied, and the backstop prunes the rest.

**One bust is worth one achievement push.** Four layers, and all of them are load-bearing:

1. `pickAnnounceableUnlock()` narrows the client's announcement to the single
   highest-XP unlock. (Note: *highest XP*, not "first" — the unlock array is in
   catalog declaration order, which is arbitrary, and all unlocks from one bust
   share an `unlocked_at`, so "first" is not well defined.)
2. `announceAchievement()` claims a per-actor 10-minute slot in `push_events`
   before announcing. Atomic, because the client fires announcements
   concurrently and a read-then-check would let a whole burst through.
3. `retireUnannouncedSiblings()` claims the rows the client *declined* to
   announce. Without this the cap was a delay, not a cap: those rows sat in the
   backstop's one-hour lookback with no ledger row, and the next sweep claimed a
   fresh slot and pushed one of them. The crew was getting **two** achievement
   pushes per bust, ten minutes apart.
4. `notify-event`'s 12-per-5-minute ceiling, counting `kind = 'achievement'`
   only. Busts are exempt — a bust is news and must never be dropped as
   collateral, and it is already capped at one per two hours by the trigger.

**Achievements are all AWARDED, only the push is capped.** There is no
one-achievement-per-bust award limit anywhere, and adding one is harder than it
looks: eligibility is a pure function of the user's full bust history,
recomputed from scratch on every reconcile (`computeAchievementUnlocks`). "Do not
count that point" is not expressible as an absence — the next recompute re-derives
it. It would need new persistent state linking each `achievements` row to the bust
that paid for it, and it would cost the idempotent reconcile that makes the whole
system safe to re-run.

**A suppressed announcement is still claimed.** Declining to push means writing
the `push_events` row anyway with zero recipients. Skip the claim and the
backstop re-evaluates that row on every run for the whole lookback window.

**"Delivered" from a push service is not delivered.** `sendNotification`
resolving means FCM/Mozilla/Apple *accepted* the message. There is no delivery
receipt in the web push protocol, so `last_success_at` and
`DeliveryResult.delivered` systematically overstate reality. Read a missing ack
as *unconfirmed*, never as undelivered.

**A failed reminder is not retried.** `dispatch-inactivity-reminders` advances the
cycle on any attempt. Leaving a failure due meant re-sending every ten minutes
until `bump_push_failure` evicted the subscription. Losing one nag out of a 5–7
day cycle is the cheaper failure.

**Compare instants, never timestamp strings.** Postgres emits
`2026-08-25T12:00:00.123456+00:00`; `toISOString()` emits
`2026-08-25T12:00:00.123Z`. A string compare is false for every row read back.
Everything goes through `toEpochMs()`.

**A claim is released if delivery fails**, or the backstop would skip that row
forever.

**`startMessages()` is required.** The `ServiceWorkerContainer` queue only starts
when an `onmessage` property is assigned. With `addEventListener` alone,
everything the worker posts is queued and never delivered.

**One endpoint, one account.** `push_subscriptions` is unique on `endpoint` and
`register-push-subscription` upserts `onConflict: 'endpoint'`, so a shared browser
transfers the row in one statement. That upsert UPDATEs, so any column that must
not be inherited has to be in the payload — `failure_count` is reset there for
that reason.

**`ack-push` is unauthenticated on purpose.** A service worker has no access to
the page's Supabase session. The per-delivery `receipt_id` is the entire
authorisation: an unguessable UUID granting exactly one capability. It answers
204 either way so it cannot be probed, and the update is filtered on
`acked_at is null` so a replay is a no-op.

**iOS requires installation.** Safari exposes `Notification`/`PushManager` only
inside a PWA launched from the Home Screen (iOS 16.4+). Until then the app
reports `ios-needs-install`.

**VAPID keys must match on both sides.** `VITE_WEB_PUSH_PUBLIC_KEY` (browser
build) and `VAPID_PUBLIC_KEY` (function secret) must be identical, or every push
is signed with a key the subscription was not created for.

---

## 5. Discord webhook notifications

Optional, off by default. Mirrors every bust and every achievement unlock into
a Discord channel via an incoming webhook, as a rich embed (title, description,
color, and — for achievements — the tier badge sprite as a thumbnail).
**Idle/inactivity reminders are never sent to Discord**; `dispatch-inactivity-reminders`
does not import this code path and never will.

### Why it is separate from push

Push is paced on purpose — a cooldown-bounded bust, a ten-minute achievement
slot, a 12-per-5-minute ceiling — because it lands on a lock screen. None of
that applies to a Discord channel, and the requirement here is literally "every
bust, every achievement". So Discord delivery is **not** gated by any of the
push pacing in section 4: it has its own exactly-once ledger
(`discord_events`, the Discord analogue of `push_events`) and fires regardless
of whether the push for the same row was sent, suppressed, or had no
recipients.

### Pieces

| Piece | Role |
| --- | --- |
| `supabase/migrations/20260930010000_discord_webhook.sql` | `discord_settings` (singleton config row) + `discord_events` (exactly-once ledger). Both RLS-enabled with zero policies — service role only, same pattern as `push_events`. |
| `src/discordTemplate.js` | `{{TOKEN}}` templates → Discord embed JSON. Its own token set (`{{USER}}`, `{{NOTE}}`, `{{CITY}}`, `{{TIER}}`, `{{POINTS}}`, `{{PUSH_TITLE}}`/`{{PUSH_BODY}}`, …) — distinct from the crew-broadcast tokens, because a Discord message renders once per *event*, not once per *recipient*. Shares the engine in `src/templateTokens.js` with `broadcastTemplate.js`. |
| `supabase/functions/_shared/discord.ts` | Loads settings, builds the payload, POSTs to the webhook, claims/releases/finishes `discord_events` (claim/release via the shared `_shared/eventLedger.ts` helper, also used by `push.ts`). `sendDiscordNotification()` never throws — a Discord outage can't take down push. |
| `supabase/functions/_shared/announce.ts` | Calls `sendDiscordNotification()` from both `announceBust` and `announceAchievement`, so both `notify-event` (instant) and `dispatch-push-backstop` (scheduled sweep) cover Discord automatically. |
| `supabase/functions/admin-discord-settings/` | Admin-gated (same allowlist as `admin-set-password`) read/write of `discord_settings`. |
| `supabase/functions/discord-test-notification/` | Admin-gated: fires one sample bust/achievement embed, optionally previewing unsaved settings, so an admin can check a template before it goes live. |
| Debug menu → **DISCORD** tab | Enable switches, webhook URL override, bot identity, colors, mention content, templates, and the two test-send buttons. |

### Configuration

Nothing is required for the app to keep working without Discord — `enabled`
defaults to `false`. To turn it on:

1. Discord server → **Server Settings → Integrations → Webhooks → New Webhook**, copy the URL.
2. Either set it as the `DISCORD_WEBHOOK_URL` Edge Function secret
   (`supabase secrets set DISCORD_WEBHOOK_URL=...`, same mechanism as
   `VAPID_PRIVATE_KEY`), or paste it into the DISCORD tab's webhook field,
   which overrides the secret. Optionally also set `SITE_URL` so achievement
   embeds can link an absolute badge sprite URL (`public/badges/512/*.png`).
3. Flip "Discord integration enabled" in the DISCORD tab, use SEND TEST BUST /
   SEND TEST ACHIEVEMENT to confirm, then enable it for real.

`DISCORD_WEBHOOK_URL` and `SITE_URL` are regular Edge Function secrets, so they
are settable as GitHub repository secrets the same way `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` / `REMINDER_CRON_SECRET` are — see `.env.example` and
section 8 (Secrets) below.

---

## 6. Stale installs

An installed PWA is not a page you refresh — iOS keeps one document alive for
weeks. A stale install keeps running an old push registration path, so a push fix
never reaches the device that needed it.

`vite.config.js` stamps `__BUILD_ID__` into the bundle and emits the same value
as `version.json`. `src/appVersion.js` fetches it on foreground (rate-limited) and
a mismatch raises a non-blocking update banner. A second banner reports
notification permission revoked outside the app. `sw.js` already calls
`skipWaiting()`, so the worker and the page version independently — only a reload
replaces the page.

---

## 7. Debug menu

Long-press or right-click **DELETE ACCOUNT** in the profile overlay.

| Tab | What it does |
| --- | --- |
| BUST / PROGRESS / SESSION | session-only sandbox; invisible to the crew |
| NOTIFY | **real** push to selected users or everyone; admin-gated server-side |
| DELIVERY | `push_deliveries` sent-vs-acknowledged, per event |
| DEVICE | this device only: build id, worker version, permission, platform, endpoint health, self-only test ping, manual endpoint rotation |
| ACCOUNTS | admin password reset — this is account takeover, see below |
| TOOLS | unwired components |

`BROADCAST_ADMINS` (comma-separated SHA-256 hex digests) gates both
`broadcast-test-notification` and `admin-set-password`. Be clear-eyed: the second
is account takeover and the same secret authorises both. A digest of a profile
UUID is genuinely restrictive; a digest of a username is obfuscation only.
Generate one with:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('VALUE').digest('hex'))"
```

---

## 8. Deploying

`main` → `deploy.yml` → tests → **`supabase db push`** → deploy every Edge
Function → build → Pages. Migrations lead functions, because a function deployed
against a missing column fails at runtime, not at deploy.

Migrations were **not** applied by CI before 2026-09-13, which is how
`push_deliveries` went missing in production while the deployed functions
referenced it.

**Migration filenames need a full `YYYYMMDDHHMMSS_` prefix.** Supabase derives the
version from the leading digits and it is a primary key, so two files sharing a
`YYYYMMDD` prefix collide. The older 8-digit files work only because there is at
most one per day.

### Secrets

| Where | Name |
| --- | --- |
| GitHub Actions | `SUPABASE_ACCESS_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WEB_PUSH_PUBLIC_KEY`, `SUPABASE_FUNCTIONS_URL`, `REMINDER_CRON_SECRET` |
| Supabase functions | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `REMINDER_CRON_SECRET`, `BROADCAST_ADMINS`, optionally `VAPID_SUBJECT`, optionally `DISCORD_WEBHOOK_URL`, `SITE_URL` (section 5) |

Never give a service-role or VAPID **private** key a `VITE_` prefix.

One-time Supabase setup: Authentication → Sign In/Up → **disable Confirm email**
(the app uses synthetic addresses). Repo Settings → Pages → Source: GitHub Actions.

---

## 9. Checks

| Command | Covers |
| --- | --- |
| `npm run lint` | `src/`, `server/`, `scripts/`, `public/sw.js` |
| `npm run format:check` | prettier — **runs in CI, will fail the build** |
| `npm run typecheck` | browser app (`tsc --noEmit`) |
| `npm run lint:functions` | `supabase/functions/` (`deno lint`) |
| `npm run typecheck:functions` | `supabase/functions/` (`deno check`, strict) |
| `npm test` | vitest |

Edge Functions are Deno TypeScript and invisible to eslint/tsc. Because they
type-check under `strict`, the shared modules they import from `src/` carry
JSDoc annotations — those are **load-bearing**: drop them and callbacks in
`fetchAllPages` land as implicit `any`. A PostgREST builder is a *thenable*, not
a `Promise`, so callback types must be `PromiseLike`.

**Nothing executes the Edge Functions in CI.** Type-checking will not catch a
wrong table name or a broken RLS assumption.

Local SQL against production (the CLI is authenticated, project linked):

```bash
supabase db query "select * from push_subscription_health()" --linked
supabase db push --linked --yes      # --yes: it prompts otherwise
```

`supabase db dump` / `db diff` need Docker; `db query` and `db push` do not.

---

## 10. Diagnosing a device that gets nothing

1. **Debug menu → DEVICE → TEST PING THIS DEVICE.** Exercises VAPID signing, the
   push service and the worker in one round trip, scoped to that endpoint alone.
2. **Read the DEVICE tab's health rows.** A climbing *sent unacked* with *last
   confirmed: never* is a ghost endpoint — hit ROTATE.
3. **Read the message, not the permission state.** Every failure mode has its own
   string (`ios-needs-install`, `no-vapid-key`, `register-failed`, …). A green
   permission toggle never implies a stored subscription.
4. **Check the dispatchers.** Actions → *Notification dispatch* → Run workflow.
5. **Check the ledger.** `push_events` shows recipients/delivered per event;
   `push_subscription_health()` shows per-endpoint reality.
6. **OS-level settings.** Focus modes and per-site settings suppress delivery
   after the browser has accepted it.

A 404/410 from a push service for a synthetic endpoint means the request was
signed correctly. A 401/403 means the credentials are wrong.

---

## 11. Repo map

```
src/main.jsx            app shell, dashboard, overlays, bust flow
src/rules.js            cooldown, XP, streaks, records, legacy + progression catalog
src/expansion.js        expansion/social/market achievement catalog
src/backend.js          dual-mode backend adapter
src/notifications.js    permission, service worker, subscription, rotation
src/notificationMessages.js  copy, shared verbatim with the Edge Functions
src/appVersion.js       stale-install detection
src/pushCooldown.js     achievement announce slot ids
src/inactivityReminder.js  the 5-7 day nag state machine
src/templateTokens.js   shared {{TOKEN}} template engine
src/broadcastTemplate.js  crew-broadcast {{TOKEN}} templates (per-recipient)
src/discordTemplate.js  Discord webhook {{TOKEN}} templates + embed builders (per-event)
src/DebugMenu.jsx       the debug overlay
src/charts.jsx          SVG chart primitives
public/sw.js            push receiver; NOT a caching worker
server/                 Express dev-mode API (separate account store)
supabase/migrations/    the schema, single source of truth
supabase/functions/     Edge Functions (Deno)
scripts/generate-icons.py   regenerates public/icons from art/
```

### Icons

Everything in `public/icons/` except `badge-96.png` is generated — edit the
masters in `art/`, never the output, then run `python scripts/generate-icons.py`.
`art/Favicon.png` feeds the tab icons; `art/PWA-icon.png` feeds the installed-app
icons. Alpha is preserved except on `icon-maskable-512.png` and
`apple-touch-icon.png`, which are flattened onto `#0a0a0b` because Android applies
its own mask and iOS ignores alpha. `badge-96.png` is hand-made (monochrome
Android status-bar mask) and is not regenerated.

Sign-ups require the invite code `bust4me` (compared case-insensitively).

---

## 12. Known gaps

- No CI execution of Edge Functions; a wrong table name ships.
- Server mode (`server/`) is unused in practice but still tested and still
  maintained by CI. A candidate for removal.
- `busts` has both `time_bucket` (stored) and a derivable bucket from
  `timestamp`; `derivePersonalStats` prefers the stored one and falls back.
- `profiles` carries a redundant case-sensitive `username` unique constraint
  alongside the `lower(username)` index that actually defines identity.
- `charts.jsx` is at ~30% test coverage; it is presentational.
- **iOS re-prompts for location on every bust when the app is installed to the
  Home Screen.** Researched, not a bug in this codebase: iOS/WebKit does not
  persist `navigator.geolocation` permission for a standalone (installed) PWA
  the way it persists it for the same site open as a normal Safari tab — the
  installed app runs in a separate, more tightly sandboxed context. This is
  widely reported by other PWA developers (see WebKit bug 215884 and
  Apple Developer Forums thread 694999) with no documented fix or workaround on
  the web platform side as of this writing; Apple's own stance treats it as
  intentional sandboxing, not a defect. `src/permissionRequests.js` already
  treats every `requestLocation()` call as something that may re-prompt and
  handles it (ASKING… / retry), so behaviour is correct — just, on iOS,
  surprising. Left as-is per the above; revisit if WebKit changes this.
