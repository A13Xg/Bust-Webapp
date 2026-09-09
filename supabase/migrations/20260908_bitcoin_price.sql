-- =============================================================
-- BUST — Bitcoin spot price per bust
--
-- Stamped alongside temperature, pressure, elevation and tide. Nullable and
-- unconstrained beyond a sanity bound: market data is best-effort context, and
-- a bust must never be rejected because a price lookup failed.
--
-- Repeatable: safe to run multiple times.
-- =============================================================

alter table public.busts add column if not exists btc_usd numeric;

-- Rules out a client stamping a nonsense figure without pinning a price range
-- that a few years of volatility could invalidate.
do $$
begin
  alter table public.busts
    add constraint busts_btc_usd_sane check (btc_usd is null or (btc_usd > 100 and btc_usd < 100000000));
exception
  when duplicate_object then null;
end;
$$;

-- Supports the analytics scatter and the personal high/low achievement checks.
create index if not exists busts_btc_usd_idx on public.busts (btc_usd) where btc_usd is not null;

-- New achievement ids, so the legacy SQL reconciler in setup.sql accepts them
-- too. The Edge Function validates against the JavaScript catalog instead, but
-- the two lists should not silently diverge.
insert into public.achievement_catalog (id)
select x.id
from unnest(array[
  'sats_stacker','six_figure_summit','capitulation_witness','personal_ath','personal_atl',
  'whipsaw','number_go_up','number_go_down','genesis_block_day','pizza_day','whitepaper_day',
  'diamond_hands','round_number_ritual','market_hours_mogul'
]) as x(id)
on conflict (id) do nothing;

-- ---------- push delivery health ----------
-- A push service can reject an endpoint for reasons that are not "gone" (404/410).
-- The important one is 403, returned when the subscription was created without
-- our VAPID key: it never recovers, but nothing prunes it, so the endpoint is
-- retried forever. Count consecutive failures and drop an endpoint that has
-- clearly stopped working. A single success resets the counter to zero.
create or replace function public.bump_push_failure(subscription_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  update public.push_subscriptions
  set failure_count = failure_count + 1,
      updated_at = now()
  where id = any(subscription_ids);

  -- Generous threshold: transient 5xx from a push service is routine, and at the
  -- dispatch cadence this is several days of uninterrupted failure.
  with gone as (
    delete from public.push_subscriptions
    where id = any(subscription_ids)
      and failure_count >= 25
    returning 1
  )
  select count(*) into removed from gone;

  return removed;
end;
$$;

revoke all on function public.bump_push_failure(bigint[]) from public;
revoke all on function public.bump_push_failure(bigint[]) from anon;
revoke all on function public.bump_push_failure(bigint[]) from authenticated;
