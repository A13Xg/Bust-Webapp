-- =============================================================
-- BUST — core schema baseline
--
-- WHY THIS EXISTS
--
-- The core tables (profiles, busts, achievements, achievement_catalog), their
-- RLS policies and the realtime publication lived only in `supabase/setup.sql`,
-- a file nothing ever ran automatically. Everything else lived in
-- `supabase/migrations/`. Two sources of truth for one schema, and they drifted:
-- setup.sql still created a `bust_insert_trigger` calling `on_bust_insert()`
-- (production has neither — `enforce_bust_cooldown` took that job over and does
-- it under a `for update` lock), still defined a SQL `reconcile_achievements()`
-- that no longer matched the achievement rules the app actually uses, and knew
-- nothing about `busts.btc_usd`. Running it against a fresh project produced an
-- app that did not work.
--
-- This migration adopts the contents of setup.sql, corrected to match what
-- production actually contains, so `supabase db push` alone can build the schema
-- from nothing. setup.sql is deleted in the same commit.
--
-- Applying this to an existing project is a no-op: every statement is either
-- `if not exists` or a drop-then-create of an object identical to the one
-- already there.
-- =============================================================

-- ---------- Core tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (length(username) between 2 and 32),
  avatar_seed text not null,
  created_at timestamptz not null default now(),
  last_bust_timestamp timestamptz,
  tagline text,
  showcase text
);
alter table public.profiles add column if not exists tagline text;
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
  elevation_ft numeric,
  tide_ft numeric,
  time_bucket text not null
);
alter table public.busts add column if not exists elevation_ft numeric;
alter table public.busts add column if not exists tide_ft numeric;

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_type text not null,
  unlocked_at timestamptz not null default now(),
  unique (user_id, achievement_type)
);

-- Referenced by achievements.achievement_type (see
-- 20260908030000_achievement_catalog_foreign_key.sql). Its whole job is to make
-- a typo'd or retired achievement id a foreign-key error at write time instead
-- of a row the UI silently cannot render.
create table if not exists public.achievement_catalog (
  id text primary key
);

create index if not exists busts_timestamp_idx on public.busts (timestamp desc);
create index if not exists busts_user_timestamp_idx on public.busts (user_id, timestamp desc);

-- ---------- Catalog contents ----------
--
-- Must stay equal to the ids in src/rules.js. src/achievementCatalog.test.js
-- parses this list and compares it to the catalog, which is the only thing
-- standing between a renamed achievement and a foreign-key violation on unlock.
insert into public.achievement_catalog (id)
select x.id
from unnest(array[
  'first_release','double_shift','night_ops','early_bird','heat_seeker','cold_front','high_pressure','field_reporter','hat_trick','week_warrior','cartographer',
  'scorcher_achievement','scorcher_badge','scorcher_trophy','daypart_achievement','daypart_badge','daypart_trophy','marathon_achievement','marathon_badge','marathon_trophy',
  'weekend_achievement','weekend_badge','weekend_trophy','pressure_achievement','pressure_badge','pressure_trophy','cold_achievement','cold_badge','cold_trophy',
  'scribe_achievement','scribe_badge','scribe_trophy','cartographer_achievement','cartographer_badge','cartographer_trophy','streak_achievement','streak_badge','streak_trophy',
  'night_achievement','night_badge','night_trophy','on_the_dot','palindrome_pressure','photo_finish','midnight_strike','high_noon_ace','leap_of_faith','new_year_new_me',
  'spooky_splash','solstice_ritual','birthday_suit','minute_hand','second_hand','buzzer_beater','cooldown_surgeon','calendar_collector','anniversary_chain',
  'first_responder','chain_reaction','synchronized_swimmers','lone_wolf','pace_setter','wingman','squadron_leader','twin_turbines','opening_ceremony','business_hours',
  'full_rotation','monthly_subscriber','quarterly_report','dry_spell_broken','clockwork','payroll_regular','perfect_month','season_ticket','metronome','phoenix',
  'daily_double_decade','storm_chaser','perfect_conditions','traveler','jet_setter','border_runner','home_base','freezing_point','sea_level_scout','thin_air',
  'cloudline_climber','low_tide_logger','high_tide_hero','tidal_duality','weather_vane','thermometer_breaker','storm_rider','climate_diplomat','odometer',
  'landmark_legend','mile_high_club','altitude_sampler','summit_circuit','low_tide_regular','high_tide_devotee','tide_master','emoji_artist','haiku_master',
  'novelist','man_of_few_words','shakespeare','emoji_dictionary','poet_laureate','full_manuscript','minimalist_monk','bard_of_the_bay','completionist_i',
  'completionist_ii','completionist_iii','xp_tycoon','the_collector'
]::text[]) as x(id)
on conflict (id) do nothing;

-- ---------- Row level security ----------

alter table public.profiles enable row level security;
alter table public.busts enable row level security;
alter table public.achievements enable row level security;
alter table public.achievement_catalog enable row level security;

-- Profiles: any signed-in member can read the crew; you manage only your own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- No delete policy on purpose. Account deletion goes through the delete-account
-- Edge Function, which removes the auth.users row and lets the cascade take the
-- profile with it. A client-side profile delete would leave the auth user behind
-- holding this username's synthetic email, making the name unregisterable
-- forever. Cascades bypass RLS, so the real path needs no policy.
drop policy if exists profiles_delete on public.profiles;

-- Busts: crew-readable; inserts are yours only AND blocked during the cooldown.
--
-- The policy is not the real cooldown enforcement — `enforce_bust_cooldown`
-- (20260723) is, because it takes a `for update` lock on the profile row and so
-- cannot be raced by two concurrent inserts. This check is the cheap first line
-- that rejects the common case before the trigger runs.
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

-- Achievements: crew-readable, and deliberately NOT client-writable.
--
-- There is no insert policy and there must not be one. Unlocks are written by
-- the reconcile-achievements Edge Function under the service role, which
-- recomputes eligibility from the caller's own bust history; a client insert
-- policy would let anyone award themselves anything.
drop policy if exists achievements_select on public.achievements;
create policy achievements_select on public.achievements for select to authenticated using (true);
drop policy if exists achievements_insert on public.achievements;

-- achievement_catalog: RLS on with no policy, so it is service-role only. The
-- browser never reads it — src/rules.js is the client's copy of the catalog —
-- and it exists here purely as the foreign-key target.

-- ---------- Realtime ----------
-- Bust inserts/updates and profile updates are broadcast to open clients.
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
