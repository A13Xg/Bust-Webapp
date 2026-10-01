-- =============================================================
-- BUST — Discord webhook notifications
--
-- Lets the crew mirror busts and achievements into a Discord channel via an
-- incoming webhook, fully configurable by an admin without a redeploy. Two
-- tables:
--
--   discord_settings — a single configuration row (id = 1). Admin-only, read
--                       and written exclusively through the
--                       `admin-discord-settings` Edge Function (service role).
--                       RLS is enabled with zero policies, same pattern as
--                       `push_events` below: a deny-all for anon/authenticated,
--                       bypassed only by the service role key that never
--                       leaves the Edge Functions.
--
--   discord_events    — exactly-once ledger, the Discord analogue of
--                        `push_events` (see 20260907_push_delivery.sql). Kept
--                        separate from `push_events` on purpose: Discord
--                        delivery must never be throttled by, or interfere
--                        with, the mobile-push cooldown/slot bookkeeping — the
--                        requirement is "every bust, every achievement",
--                        independent of how push notifications are paced.
--
-- Idle/inactivity reminders are intentionally never routed through either of
-- these — `dispatch-inactivity-reminders` does not import `_shared/announce.ts`
-- (or `_shared/discord.ts`) and never will; see supabase/functions/_shared/discord.ts.
--
-- Repeatable: safe to run multiple times.
-- =============================================================

create table if not exists public.discord_settings (
  -- Singleton row. The check pins it to id = 1 so there can only ever be one.
  id boolean primary key default true,
  enabled boolean not null default false,
  bust_enabled boolean not null default true,
  achievement_enabled boolean not null default true,
  -- Optional override; falls back to the DISCORD_WEBHOOK_URL Edge Function
  -- secret when null so a webhook URL never has to live in the database.
  webhook_url text,
  bot_username text,
  bot_avatar_url text,
  footer_text text,
  -- Hex color (e.g. "#5865F2") applied to bust embeds. Achievement embeds use
  -- the achievement's own `accent` from src/rules.js unless this is set, which
  -- overrides it for every tier.
  bust_color text,
  achievement_color text,
  -- Rendered through src/discordTemplate.js — the same {{TOKEN}} syntax as the
  -- debug-menu broadcast (src/broadcastTemplate.js), with its own token set.
  bust_title_template text,
  bust_description_template text,
  achievement_title_template text,
  achievement_description_template text,
  -- Optional content shown above the embed, e.g. "<@&123456789012345678>" to
  -- ping a role, or "@everyone". Left blank by default — pinging is opt-in.
  mention_content text,
  include_thumbnail boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint discord_settings_singleton check (id = true)
);

alter table public.discord_settings enable row level security;
-- Deliberately no policies: configuration is admin-only and never read or
-- written directly by a client, only via the Edge Function's service role.

create table if not exists public.discord_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('bust', 'achievement')),
  source_id text not null,
  actor_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  success boolean,
  status_code integer,
  error text,
  unique (kind, source_id)
);

create index if not exists discord_events_created_idx on public.discord_events (created_at desc);

alter table public.discord_events enable row level security;
-- Same deny-all pattern as push_events: service role only.
