# Deploying BUST

## Option A — GitHub Pages + Supabase (no server)

The app has a built-in static mode: when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present at build time, it talks to Supabase directly (Auth, Postgres via RLS, Realtime) instead of the Node API.

One-time setup:

1. **Supabase SQL** — open the SQL Editor in your Supabase project and run `supabase/setup.sql`, then every file in `supabase/migrations/` in filename order.
2. **Auth setting** — Dashboard → Authentication → Sign In / Up → turn **off** "Confirm email" (the app generates synthetic emails per the spec).
3. **GitHub secrets** — repo Settings → Secrets and variables → Actions → add:
   - `VITE_SUPABASE_URL` — e.g. `https://hshcpohxpfzpbvepuapt.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` — Dashboard → Settings → API → `anon` `public` key (safe to expose; RLS is the security boundary)
   - `VITE_WEB_PUSH_PUBLIC_KEY` — VAPID public key used by PushManager subscription
4. **Deploy Supabase functions**:
   - `supabase functions deploy reconcile-achievements`
   - `supabase functions deploy register-push-subscription`
   - `supabase functions deploy dispatch-inactivity-reminders`
   - Set function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and optional `REMINDER_CRON_SECRET`
4. **Enable Pages** — repo Settings → Pages → Source: **GitHub Actions**.
5. Push to `main`/`master`. The included workflow (`.github/workflows/deploy.yml`) tests, builds, and deploys to `https://<you>.github.io/Bust-Webapp/`.

Notes for static mode:
- The 2-hour cooldown is enforced by an RLS policy in Postgres, so it can't be bypassed by reloading or editing the client.
- The invite code is checked client-side only in this mode (fine for satire; the anon key + RLS still protects data).
- Server mode's `users` table and static mode's `profiles` table are separate — accounts don't carry over.

## Option B — Local / self-hosted (Node server)

```
npm install
npm run db:migrate   # once; RESET_DB=1 to wipe
npm run dev          # API :8787 + client :5173
```

Uses `.env` (`DATABASE_URL`, `JWT_SECRET`, `PORT`). `DEMO_DB=1` runs an in-memory database. `GET /api/health` reports DB connectivity if something looks wrong.
