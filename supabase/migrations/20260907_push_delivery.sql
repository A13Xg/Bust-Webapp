-- =============================================================
-- BUST — reliable push delivery
--
-- Adds the bookkeeping the crew-wide push fan-out needs on top of the tables
-- created by 20260724_mobile_push_reminders.sql:
--
--   * push_events        — exactly-once ledger so a bust/achievement can never
--                          be announced twice, no matter how many callers race
--                          (the busting client fans out immediately; a cron
--                          backstop sweeps up anything the client missed).
--   * endpoint uniqueness— one browser endpoint belongs to exactly one account.
--                          Without it, two people sharing a browser each keep a
--                          row for the same endpoint and receive each other's
--                          notifications.
--   * delivery health    — last_success_at / failure_count make a dead
--                          subscription visible instead of silently invisible.
--
-- Repeatable: safe to run multiple times.
-- =============================================================

-- Guard against 20260724 having been skipped on this project.
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists public.inactivity_reminders (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cycle_bust_at timestamptz not null,
  scheduled_for timestamptz,
  last_sent_at timestamptz,
  last_message_index integer,
  updated_at timestamptz not null default now()
);

-- ---------- delivery health ----------
alter table public.push_subscriptions add column if not exists last_success_at timestamptz;
alter table public.push_subscriptions add column if not exists failure_count integer not null default 0;

-- ---------- one endpoint, one account ----------
delete from public.push_subscriptions a
using public.push_subscriptions b
where a.endpoint = b.endpoint
  and a.id < b.id;

create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions (endpoint);

-- ---------- exactly-once announcement ledger ----------
create table if not exists public.push_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('bust', 'achievement')),
  source_id text not null,
  actor_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  recipients integer not null default 0,
  delivered integer not null default 0,
  unique (kind, source_id)
);

create index if not exists push_events_created_idx on public.push_events (created_at desc);

-- Service-role only. RLS enabled with zero policies is a complete deny for both
-- `anon` and `authenticated`; the service role bypasses RLS. Deliberately no
-- policy is defined here — clients never read or write this ledger.
alter table public.push_events enable row level security;

-- ---------- reminder reset trigger (idempotent re-declaration) ----------
-- A fresh bust clears the user's reminder cycle, so the 5-7 day clock restarts.
create or replace function public.reset_inactivity_reminder_on_bust()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.inactivity_reminders (user_id, cycle_bust_at, scheduled_for, last_sent_at, last_message_index, updated_at)
  values (new.user_id, new.timestamp, null, null, null, now())
  on conflict (user_id) do update
    set cycle_bust_at = excluded.cycle_bust_at,
        scheduled_for = null,
        last_sent_at = null,
        last_message_index = null,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists bust_reset_inactivity_reminder on public.busts;
create trigger bust_reset_inactivity_reminder
after insert on public.busts
for each row execute function public.reset_inactivity_reminder_on_bust();

-- ---------- retire the in-database cron scheduler ----------
-- Dispatch is now driven by the repository's scheduled GitHub Actions workflow
-- (.github/workflows/notify-cron.yml), which needs no service-role key or
-- function URL stored inside the database. Drop the old pg_cron job if a
-- previous deployment installed one, so reminders cannot be sent twice.
do $$
begin
  perform extensions.cron.unschedule('dispatch-inactivity-reminders');
exception
  when others then null;
end;
$$;
