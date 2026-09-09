-- =============================================================
-- Usernames are one identity regardless of case: alexg, AlexG and
-- ALEXG are the same person and only one of them can exist.
--
-- Two problems this closes:
--
--   * `username text unique` is CASE-SENSITIVE in Postgres, so 'AlexG'
--     and 'alexg' were two legal rows. Server mode then logs in with
--     `where lower(username)=lower($1)` and silently takes rows[0] —
--     whichever row Postgres happened to return first.
--   * `profiles_update` grants update on every column of your own row,
--     username included. Combined with the above, any crew member could
--     rename themselves onto the broadcast allowlist (which authorises on
--     a hash of the username). Usernames are world-readable, so picking
--     the target was trivial.
--
-- The app never offers a username change — patchProfile whitelists
-- tagline, avatar_seed and showcase — so freezing it costs no feature.
--
-- Repeatable: safe to run multiple times.
-- =============================================================

-- ---------- guard: refuse to run against colliding data ----------
-- A unique index would fail here with an opaque "could not create unique
-- index" error. Say what actually needs fixing instead.
do $$
declare
  collisions text;
begin
  select string_agg(name, ', ')
    into collisions
    from (
      select lower(username) as name
        from public.profiles
       group by lower(username)
      having count(*) > 1
    ) duplicated;

  if collisions is not null then
    raise exception
      'Cannot enforce case-insensitive usernames yet: these names exist in more than one casing: %. Delete or rename the duplicates, then re-run this migration.',
      collisions;
  end if;
end $$;

-- ---------- one identity per name, regardless of case ----------
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- ---------- usernames are immutable ----------
-- The unique index alone already blocks renaming ONTO an existing name,
-- but a name freed by a deleted account could still be claimed. Since
-- nothing in the app renames a profile, forbid it outright.
create or replace function public.block_username_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.username is distinct from old.username then
    raise exception 'Username cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_username_change on public.profiles;
create trigger profiles_block_username_change
  before update on public.profiles
  for each row
  execute function public.block_username_change();
