# BUST

[![CI](https://github.com/A13Xg/Bust-Webapp/actions/workflows/ci.yml/badge.svg)](https://github.com/A13Xg/Bust-Webapp/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/A13Xg/Bust-Webapp/actions/workflows/deploy.yml/badge.svg)](https://github.com/A13Xg/Bust-Webapp/actions/workflows/deploy.yml)
[![Live Site](https://img.shields.io/badge/GitHub_Pages-live-ff5e00?logo=github)](https://a13xg.github.io/Bust-Webapp/)


A real-time, mobile-first, satirical pressure-logging web app for a private crew. Press the button, ride the milk explosion, climb the leaderboard, and collect an unreasonable number of badges.

## Features
- Giant BUST button with charge → explosion → note-capture sequence, SFX, and haptics
- 2-hour cooldown enforced server-side (or by Postgres RLS in static mode)
- Real-time group feed (WebSocket or Supabase Realtime) with toasts + system notifications
- Environmental context per bust: temperature, barometric pressure, city (reverse-geocoded)
- Analytics bay: leaderboard with sparklines & streaks, 30-day trend, daypart donut, hour histogram, weekly bars, weekday×hour heatmap, temp/pressure scatter with hover tooltips, all-time records
- Operator profiles: XP levels with satirical rank titles, editable tagline, avatar re-roll, personal charts, badge showcase, permission controls
- 100+ achievements & badges (Material Symbols icons, tier-colored cards) that auto-unlock client-side

## Running
Local (Node API + Postgres/Supabase via `DATABASE_URL`, or `DEMO_DB=1` for in-memory):
```
npm install
npm run db:migrate
npm run dev        # API :8787 + Vite :5173
```
Static / GitHub Pages (no server — Supabase Auth + RLS + Realtime): see `DEPLOY.md`.

## CI / GitHub Pages
- `CI` installs with `npm ci`, migrates a disposable PostgreSQL service, runs Vitest, verifies the DB connection/schema, and builds the page.
- `Deploy to GitHub Pages` repeats the same DB-backed checks, requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` Actions secrets, then uploads `dist/` to Pages.

Sign-ups require the invite code `Bust4Me`.

## Stack
React 19 + Vite, framer-motion, custom SVG charts, Express + `pg` (server mode), supabase-js (static mode), Vitest.

## Repo map
- `src/main.jsx` — app shell, dashboard, overlays
- `src/rules.js` — cooldown, streaks, XP levels, records, core achievement catalog
- `src/expansion.js` — expansion achievement/badge catalog + evaluators
- `src/charts.jsx` — SVG chart primitives
- `src/backend.js` — dual-mode backend adapter (REST/WS ↔ Supabase)
- `src/audio.js` — SFX manager
- `server/` — Express API, schema, migration
- `supabase/setup.sql` — static-mode tables, RLS, realtime
- `ACHIEVEMENTS_PLAN.md`, `ASSETS.md`, `DEPLOY.md` — design docs
