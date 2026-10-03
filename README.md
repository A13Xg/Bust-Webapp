# BUST

[![CI](https://github.com/A13Xg/Bust-Webapp/actions/workflows/ci.yml/badge.svg)](https://github.com/A13Xg/Bust-Webapp/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/A13Xg/Bust-Webapp/actions/workflows/deploy.yml/badge.svg)](https://github.com/A13Xg/Bust-Webapp/actions/workflows/deploy.yml)
[![Live Site](https://img.shields.io/badge/GitHub_Pages-live-ff5e00?logo=github)](https://a13xg.github.io/Bust-Webapp/)


A real-time, mobile-first, satirical pressure-logging web app for a private crew. Press the button, ride the milk explosion, climb the leaderboard, and collect an unreasonable number of badges.

## Features
- Giant BUST button with charge → explosion → note-capture sequence, SFX, and haptics
- 2-hour cooldown enforced by Postgres RLS + a trigger, not the client
- Real-time group feed (Supabase Realtime) with toasts + web push: the crew is notified when anyone busts or unlocks an achievement, plus a staggered 5-7 day nag if you go quiet (desktop, Android, and installed iOS PWAs — see `PROJECT.md`)
- Optional Discord webhooks mirror busts and achievements as admin-configurable embeds. Inactivity reminders are excluded; see `PROJECT.md`.
- Environmental + market context per bust: temperature, barometric pressure, elevation, tide, city (reverse-geocoded), and the Bitcoin spot price at the moment you pressed the button
- Analytics bay: leaderboard with sparklines & streaks, 30-day trend, daypart donut, hour histogram, weekly bars, weekday×hour heatmap, temp/pressure scatter with hover tooltips, all-time records
- Operator profiles: XP levels with satirical rank titles, editable tagline, avatar re-roll, personal charts, badge showcase, permission controls
- 130+ achievements & badges, including a Market track keyed off the BTC price at your bust (Diamond Hands, Number Go Up, Pizza Day…) (Material Symbols icons, tier-colored cards) that auto-unlock client-side

## Running
Needs `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (see `.env.example`) — the app talks to Supabase directly, there is no local server:
```
npm install
npm run dev        # Vite :5173
```

## CI / GitHub Pages
- `CI` installs with `npm ci`, lints/typechecks the app and the Edge Functions, runs Vitest, and builds the page.
- `Deploy to GitHub Pages` runs the unit tests, applies `supabase/migrations/`, deploys every Edge Function, then builds and uploads `dist/` to Pages. See `PROJECT.md` for the required secrets.

Sign-ups require the invite code `Bust4Me`.

## Stack
React 19 + Vite, framer-motion, custom SVG charts, supabase-js (Supabase Auth + Postgres/RLS + Realtime), Vitest.

## Repo map
- `src/main.jsx` — app shell, dashboard, overlays
- `src/rules.js` — cooldown, streaks, XP levels, records, core achievement catalog
- `src/bitcoin.js` — BTC spot price lookup, caching, and formatting
- `src/notifications.js`, `src/notificationMessages.js`, `public/sw.js` — web push
- `src/expansion.js` — expansion achievement/badge catalog + evaluators
- `src/charts.jsx` — SVG chart primitives
- `src/backend.js` — Supabase backend adapter (auth, postgrest, realtime)
- `src/audio.js` — SFX manager
- `supabase/migrations/` — the database schema, single source of truth
- `supabase/functions/` — Edge Functions (achievement reconciliation, push registration and dispatch)
- `PROJECT.md` — architecture, data model, notification system, deploy and triage. **Start here.**
