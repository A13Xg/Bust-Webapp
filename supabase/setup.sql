-- =============================================================
-- BUST — Supabase setup for static (GitHub Pages) mode
-- Repeatable migration: safe to run multiple times in Supabase SQL Editor.
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
  unique(user_id, achievement_type)
);

create table if not exists public.achievement_catalog (
  id text primary key
);

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

create index if not exists busts_timestamp_idx on public.busts(timestamp desc);
create index if not exists busts_user_timestamp_idx on public.busts(user_id, timestamp desc);

-- ---------- Trusted achievement reconciliation ----------
create or replace function public.reconcile_achievements()
returns table (
  id uuid,
  user_id uuid,
  achievement_type text,
  unlocked_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  with own as (
    select *
    from public.busts
    where user_id = uid
    order by timestamp asc
  ),
  base as (
    select
      count(*)::int as total,
      count(*) filter (where extract(hour from timestamp) between 0 and 3)::int as late_night_count,
      count(*) filter (where extract(hour from timestamp) between 5 and 7)::int as early_morning_count,
      count(*) filter (where temp_f is not null and temp_f > 85)::int as heat_85_count,
      count(*) filter (where temp_f is not null and temp_f < 45)::int as cold_45_count,
      count(*) filter (where pressure is not null and pressure > 1020)::int as pressure_1020_count,
      count(*) filter (where note is not null and length(trim(note)) >= 30)::int as long_note_count,
      count(*) filter (where lat is not null and long is not null)::int as coords_count,
      count(*) filter (where temp_f is not null and temp_f > 100)::int as temp_100_count,
      count(*) filter (where extract(dow from timestamp) in (0, 6))::int as weekend_count,
      count(*) filter (where extract(dow from timestamp) = 0)::int as sunday_count,
      count(*) filter (where extract(dow from timestamp) = 6)::int as saturday_count
    from own
  ),
  day_counts as (
    select date_trunc('day', timestamp) as d, count(*)::int as c
    from own
    group by 1
  ),
  max_day as (
    select coalesce(max(c), 0)::int as v from day_counts
  ),
  max_week as (
    select coalesce(max(w.cnt), 0)::int as v
    from (
      select (
        select count(*)
        from own o2
        where o2.timestamp between o1.timestamp - interval '7 days' and o1.timestamp
      )::int as cnt
      from own o1
    ) w
  ),
  dayparts as (
    select distinct
      case
        when extract(hour from timestamp) between 4 and 11 then 'morning'
        when extract(hour from timestamp) between 12 and 16 then 'noon'
        else 'night'
      end as part
    from own
  ),
  unique_dayparts as (
    select count(*)::int as v from dayparts
  ),
  hours as (
    select distinct
      case
        when extract(hour from timestamp) < 4 then 'late_night'
        when extract(hour from timestamp) < 8 then 'early_morning'
        when extract(hour from timestamp) < 12 then 'morning'
        when extract(hour from timestamp) < 17 then 'afternoon'
        when extract(hour from timestamp) < 21 then 'evening'
        else 'prime_night'
      end as bucket
    from own
  ),
  hour_buckets as (
    select count(*)::int as v from hours
  ),
  eligible as (
    select unnest(array_remove(array[
      case when (select total from base) >= 1 then 'first_release' end,
      case when (select v from max_day) >= 2 then 'double_shift' end,
      case when (select late_night_count from base) >= 1 then 'night_ops' end,
      case when (select early_morning_count from base) >= 1 then 'early_bird' end,
      case when (select heat_85_count from base) >= 1 then 'heat_seeker' end,
      case when (select cold_45_count from base) >= 1 then 'cold_front' end,
      case when (select pressure_1020_count from base) >= 1 then 'high_pressure' end,
      case when (select long_note_count from base) >= 1 then 'field_reporter' end,
      case when (select total from base) >= 3 then 'hat_trick' end,
      case when (select v from max_week) >= 5 then 'week_warrior' end,
      case when (select coords_count from base) >= 1 then 'cartographer' end,
      case when (select temp_100_count from base) >= 1 then 'scorcher_achievement' end,
      case when (select temp_100_count from base) >= 10 then 'scorcher_badge' end,
      case when (select temp_100_count from base) >= 25 then 'scorcher_trophy' end,
      case when (select v from unique_dayparts) >= 2 then 'daypart_achievement' end,
      case when (select v from unique_dayparts) >= 3 then 'daypart_badge' end,
      case when (select v from hour_buckets) >= 6 then 'daypart_trophy' end,
      case when (select total from base) >= 5 then 'marathon_achievement' end,
      case when (select total from base) >= 25 then 'marathon_badge' end,
      case when (select total from base) >= 100 then 'marathon_trophy' end,
      case when (select saturday_count from base) >= 1 then 'weekend_achievement' end,
      case when (select saturday_count from base) >= 1 and (select sunday_count from base) >= 1 then 'weekend_badge' end,
      case when (select weekend_count from base) >= 10 then 'weekend_trophy' end,
      case when (select pressure_1020_count from base) >= 1 then 'pressure_achievement' end,
      case when (select pressure_1020_count from base) >= 5 then 'pressure_badge' end,
      case when (select pressure_1020_count from base) >= 15 then 'pressure_trophy' end,
      case when (select cold_45_count from base) >= 1 then 'cold_achievement' end,
      case when (select cold_45_count from base) >= 5 then 'cold_badge' end,
      case when (select cold_45_count from base) >= 15 then 'cold_trophy' end,
      case when (select long_note_count from base) >= 1 then 'scribe_achievement' end,
      case when (select long_note_count from base) >= 10 then 'scribe_badge' end,
      case when (select long_note_count from base) >= 30 then 'scribe_trophy' end,
      case when (select coords_count from base) >= 1 then 'cartographer_achievement' end,
      case when (select coords_count from base) >= 10 then 'cartographer_badge' end,
      case when (select coords_count from base) >= 25 then 'cartographer_trophy' end,
      case when (select v from max_day) >= 2 then 'streak_achievement' end,
      case when (select v from max_week) >= 5 then 'streak_badge' end,
      case when (select v from max_week) >= 10 then 'streak_trophy' end,
      case when (select late_night_count from base) >= 1 then 'night_achievement' end,
      case when (select late_night_count from base) >= 7 then 'night_badge' end,
      case when (select late_night_count from base) >= 20 then 'night_trophy' end
    ], null::text)) as achievement_type
  )
  insert into public.achievements (user_id, achievement_type)
  select uid, e.achievement_type
  from eligible e
  join public.achievement_catalog c on c.id = e.achievement_type
  on conflict (user_id, achievement_type) do nothing;

  return query
  select a.id, a.user_id, a.achievement_type, a.unlocked_at
  from public.achievements a
  order by a.unlocked_at desc;
end;
$$;

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
revoke all on function public.reconcile_achievements() from public;
grant execute on function public.reconcile_achievements() to authenticated;

-- Direct achievement inserts stay blocked by RLS. Unlocks must come from
-- reconcile_achievements(), which computes earned IDs from authenticated history.

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

-- ---------- Verification snippets (run manually in SQL editor) ----------
-- 1) Arbitrary direct inserts should fail under RLS:
--    insert into public.achievements (user_id, achievement_type)
--    values (auth.uid(), 'first_release');
--
-- 2) Trusted reconciliation path should succeed and remain idempotent:
--    select count(*) from public.reconcile_achievements();
--    select count(*) from public.reconcile_achievements(); -- same or larger, never duplicates
--
-- NOTE: The SQL reconciler is authoritative for legacy + progression rules.
-- Expansion/social rules remain client-calculated for now and are intentionally
-- not inserted by the trusted SQL path in this migration.
