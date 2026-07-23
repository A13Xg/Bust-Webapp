-- BUST — atomic Supabase bust cooldown enforcement
-- Safe to run after supabase/setup.sql. Repeatable.
--
-- Why this exists:
-- The original RLS-only cooldown check could race when two inserts arrived at
-- nearly the same time. Each transaction could observe the same old
-- last_bust_timestamp before the AFTER INSERT trigger updated the profile.
--
-- This BEFORE INSERT trigger locks the authenticated user's profile row,
-- assigns an authoritative server timestamp, checks the cooldown, and updates
-- last_bust_timestamp inside the same transaction before the insert completes.

create or replace function public.enforce_bust_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  previous_bust timestamptz;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if new.user_id is distinct from uid then
    raise exception 'Cannot create a bust for another user' using errcode = '42501';
  end if;

  -- Serialize concurrent bust attempts for this user.
  select p.last_bust_timestamp
  into previous_bust
  from public.profiles p
  where p.id = uid
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = '23503';
  end if;

  -- Never trust a browser-supplied timestamp for cooldown enforcement.
  new.timestamp := clock_timestamp();

  if previous_bust is not null
     and previous_bust > new.timestamp - interval '2 hours' then
    raise exception 'Cooldown is still active' using errcode = 'P0001';
  end if;

  update public.profiles
  set last_bust_timestamp = new.timestamp
  where id = uid;

  return new;
end;
$$;

-- The BEFORE trigger is now authoritative, so remove the older AFTER trigger.
drop trigger if exists bust_insert_trigger on public.busts;
drop trigger if exists bust_cooldown_trigger on public.busts;

create trigger bust_cooldown_trigger
before insert on public.busts
for each row execute function public.enforce_bust_cooldown();

-- RLS still enforces ownership. Cooldown enforcement belongs in the locked
-- trigger above so the policy itself does not race or reject the row after the
-- trigger updates last_bust_timestamp.
drop policy if exists busts_insert on public.busts;
create policy busts_insert
on public.busts
for insert
to authenticated
with check (user_id = auth.uid());

revoke all on function public.enforce_bust_cooldown() from public;
revoke all on function public.enforce_bust_cooldown() from anon;

-- Verification notes:
-- 1. Run two simultaneous inserts for the same authenticated user. Exactly one
--    should succeed; the other should fail with "Cooldown is still active".
-- 2. Supplying an old timestamp must not bypass the cooldown because the trigger
--    replaces it with clock_timestamp().
-- 3. Supplying another user's user_id must fail with SQLSTATE 42501.
