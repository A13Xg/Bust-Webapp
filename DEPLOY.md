# Deploying BUST

## Option A — GitHub Pages + Supabase

The app has a built-in static mode: when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present at build time, it talks directly to Supabase Auth, Postgres through RLS, Realtime, and Edge Functions.

### One-time setup

1. Open the Supabase SQL Editor and run `supabase/setup.sql`, then every file in `supabase/migrations/` in filename order.
2. Dashboard → Authentication → Sign In / Up → disable **Confirm email** because the app generates synthetic emails.
3. Add these frontend deployment secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_WEB_PUSH_PUBLIC_KEY`
4. Add these Supabase Edge Function secrets:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `REMINDER_CRON_SECRET`
5. Deploy the Edge Functions:

```bash
supabase functions deploy reconcile-achievements
supabase functions deploy register-push-subscription
supabase functions deploy dispatch-inactivity-reminders --no-verify-jwt
```

6. Configure Supabase Cron to invoke `dispatch-inactivity-reminders` every 15 minutes and pass `REMINDER_CRON_SECRET` using the authorization mechanism expected by the function.
7. Repo Settings → Pages → Source: **GitHub Actions**.
8. Push to `main` or `master`. The included workflow tests, builds, and deploys the static application.

### Mobile installation and notifications

- Android Chromium browsers receive the native PWA install prompt after a user interaction when `beforeinstallprompt` is available.
- iPhone and iPad users receive a guided Add to Home Screen walkthrough because iOS does not expose a programmatic installation API.
- iOS push notifications require opening BUST from the installed Home Screen icon and granting notification permission from an explicit user action.
- The install prompt is suppressed in standalone mode and remains dismissed for seven days after the user selects **Not now**.
- Closed-browser reminders are delivered through Web Push, not the browser-only Notification constructor.

### Production verification

- Install and launch BUST as a PWA on a physical Android device.
- Add BUST to the Home Screen from Safari and launch it on a physical iPhone.
- Register push subscriptions on both devices.
- Close the browser or installed app and verify a test push arrives.
- Tap the notification and verify BUST opens or focuses correctly.
- Confirm a new bust resets and invalidates the prior reminder cycle.
- Confirm no user receives more than one inactivity reminder in any rolling 24-hour period.
- Confirm expired or revoked push subscriptions are removed by the dispatcher.

### Static-mode notes

- The two-hour cooldown is enforced in Postgres and cannot be bypassed by reloading or editing the client.
- The invite code remains client-side in static mode; the anon key and RLS protect database access.
- Server-mode `users` and static-mode `profiles` are separate account stores.
- Service-role and VAPID private keys must never use a `VITE_` prefix.

## Option B — Local or self-hosted Node server

```bash
npm install
npm run db:migrate
npm run dev
```

Use `.env` with `DATABASE_URL`, `JWT_SECRET`, and `PORT`. `DEMO_DB=1` enables the in-memory database. `GET /api/health` reports database connectivity.
