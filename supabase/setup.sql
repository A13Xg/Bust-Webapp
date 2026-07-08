-- =============================================================
-- BUST — Supabase setup for static (GitHub Pages) mode
-- Run this once in the Supabase SQL Editor.
-- Also required: Dashboard → Authentication → Sign In / Up →
--   disable "Confirm email" (the app uses synthetic emails).
-- =============================================================

-- ---------- Tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (length(username) between 2 and 32),
  avatar_seed text not null,
  created_at timestamptz not null default now(),
  last_bust_timestamp timestamptz,
  tagline text,
  showcase text
);
alter table public.profiles add column if not exists showcase text;

create table if not exists public.busts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  timestamp timestamptz not null default now(),
  note text,
  temp_f numeric,
  pressure numeric,
  lat numeric,
  long numeric,
  city text,
  time_bucket text not null
);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_type text not null,
  unlocked_at timestamptz not null default now(),
  unique(user_id, achievement_type)
);

create index if not exists busts_timestamp_idx on public.busts(timestamp desc);
create index if not exists busts_user_timestamp_idx on public.busts(user_id, timestamp desc);

-- ---------- Trigger: keep profiles.last_bust_timestamp in sync ----------
create or replace function public.on_bust_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set last_bust_timestamp = new.timestamp where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists bust_insert_trigger on public.busts;
create trigger bust_insert_trigger after insert on public.busts
  for each row execute function public.on_bust_insert();

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.busts enable row level security;
alter table public.achievements enable row level security;

-- Profiles: any signed-in member can read the crew; you manage only your own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated using (id = auth.uid());

-- Busts: crew-readable; inserts are yours only AND blocked during the 2-hour cooldown.
drop policy if exists busts_select on public.busts;
create policy busts_select on public.busts for select to authenticated using (true);
drop policy if exists busts_insert on public.busts;
create policy busts_insert on public.busts for insert to authenticated with check (
  user_id = auth.uid()
  and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.last_bust_timestamp is not null
      and p.last_bust_timestamp > now() - interval '2 hours'
  )
);
drop policy if exists busts_update_note on public.busts;
create policy busts_update_note on public.busts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Achievements: crew-readable; you unlock only your own.
drop policy if exists achievements_select on public.achievements;
create policy achievements_select on public.achievements for select to authenticated using (true);
drop policy if exists achievements_insert on public.achievements;
create policy achievements_insert on public.achievements for insert to authenticated with check (user_id = auth.uid());

-- ---------- Realtime ----------
-- Broadcast bust inserts/updates and profile updates to all clients.
do $$
begin
  begin
    alter publication supabase_realtime add table public.busts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null;
  end;
end $$;
