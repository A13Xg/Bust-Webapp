-- =============================================================
-- BUST — push endpoint liveness
--
-- THE PROBLEM THIS SOLVES
--
-- Apple invalidates a Web Push subscription without telling anyone. APNs keeps
-- answering 201 for the dead endpoint, so `isGoneError` (404/410) never fires
-- and `bump_push_failure` never records a strike. The browser is no help
-- either: `pushManager.getSubscription()` still returns a PushSubscription
-- object whose VAPID key still matches, so `subscriptionKeyMismatch()` says
-- "fine" and the app re-registers the same dead endpoint on every launch,
-- forever. Observed directly: one iPhone accumulated three web.push.apple.com
-- rows, all returning 201, only the newest of which actually rendered.
--
-- Neither end can detect this. The ONLY party that knows a notification landed
-- is the device, and the only signal it produces is the service worker's
-- acknowledgement. So liveness has to be derived from acks.
--
-- WHAT THIS ADDS
--
--   push_deliveries.subscription_id  — which endpoint a delivery went to, so an
--                                      ack can be attributed back to it. Without
--                                      this the ack loop is unusable for
--                                      liveness: the log records the recipient
--                                      USER, and a user has many devices.
--   push_subscriptions.last_ack_at   — last time this endpoint proved it lives.
--   push_subscriptions.unacked_count — consecutive sends with no ack.
--
-- Deliberately NOT a foreign key on subscription_id: pruning a dead endpoint
-- must not delete the delivery history that proved it was dead.
--
-- Repeatable: safe to run multiple times.
-- =============================================================

alter table public.push_deliveries
  add column if not exists subscription_id bigint;

create index if not exists push_deliveries_subscription_idx
  on public.push_deliveries (subscription_id, sent_at desc);

alter table public.push_subscriptions
  add column if not exists last_ack_at timestamptz;

alter table public.push_subscriptions
  add column if not exists unacked_count integer not null default 0;


-- -------------------------------------------------------------
-- mark_push_sent — one send recorded against each endpoint.
--
-- Called by sendToSubscriptions after a push service ACCEPTS a message. That
-- acceptance is not delivery, so it advances the unacked counter rather than
-- any success field; record_push_ack is what clears it.
--
-- Column arithmetic is why this is an RPC: PostgREST cannot express
-- `set unacked_count = unacked_count + 1` in an update.
-- -------------------------------------------------------------
create or replace function public.mark_push_sent(subscription_ids bigint[])
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update public.push_subscriptions
  set unacked_count = unacked_count + 1,
      updated_at = now()
  where id = any(subscription_ids);
$function$;


-- -------------------------------------------------------------
-- record_push_ack — a device confirming one notification arrived.
--
-- Stamps the delivery and, in the same call, credits the endpoint that carried
-- it. Returns true only when this ack was the first for that receipt, so a
-- replay cannot repeatedly reset a counter.
--
-- The `acked_at is null` filter is the replay guard; it is inside the CTE so
-- the subscription update only runs for a genuinely new acknowledgement.
-- -------------------------------------------------------------
create or replace function public.record_push_ack(receipt uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  acked_subscription bigint;
  found_row boolean := false;
begin
  with stamped as (
    update public.push_deliveries
    set acked_at = now()
    where receipt_id = receipt
      and acked_at is null
    returning subscription_id
  )
  select subscription_id, true into acked_subscription, found_row from stamped;

  if not found_row then
    return false;
  end if;

  -- A delivery logged before subscription_id existed has none to credit. The
  -- ack still counts as stamped; it just cannot prove which endpoint lives.
  if acked_subscription is not null then
    update public.push_subscriptions
    set last_ack_at = now(),
        unacked_count = 0,
        failure_count = 0,
        updated_at = now()
    where id = acked_subscription;
  end if;

  return true;
end;
$function$;


-- -------------------------------------------------------------
-- prune_dead_push_subscriptions — drop endpoints that provably never deliver.
--
-- Conservative on purpose. A device that is merely offline still acks when it
-- comes back, and losing a live subscription costs the user push entirely, so
-- the thresholds are set where a false positive is implausible:
--
--   * never acked once, despite `never_acked_after` sends, and old enough that
--     a real device would have been reachable at least once; or
--   * acked in the past but silent for `silent_for` while still being sent to.
--
-- Returns the number of rows removed.
-- -------------------------------------------------------------
create or replace function public.prune_dead_push_subscriptions(
  never_acked_after integer default 8,
  min_age interval default interval '2 days',
  went_silent_after integer default 25,
  silent_for interval default interval '14 days'
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  removed integer;
begin
  with gone as (
    delete from public.push_subscriptions
    where (
        last_ack_at is null
        and unacked_count >= never_acked_after
        and created_at < now() - min_age
      )
      or (
        last_ack_at is not null
        and unacked_count >= went_silent_after
        and last_ack_at < now() - silent_for
      )
    returning 1
  )
  select count(*) into removed from gone;

  return removed;
end;
$function$;


-- -------------------------------------------------------------
-- push_subscription_health — what the debug menu and the client's
-- rotate-my-endpoint check read.
--
-- Exposed as a function rather than a view so it can stay service-role only
-- without inventing an RLS policy for a view that reports on every device.
-- -------------------------------------------------------------
create or replace function public.push_subscription_health()
returns table (
  id bigint,
  user_id uuid,
  host text,
  user_agent text,
  created_at timestamptz,
  last_success_at timestamptz,
  last_ack_at timestamptz,
  unacked_count integer,
  failure_count integer,
  sent_total bigint,
  acked_total bigint
)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    s.id,
    s.user_id,
    split_part(replace(s.endpoint, 'https://', ''), '/', 1) as host,
    s.user_agent,
    s.created_at,
    s.last_success_at,
    s.last_ack_at,
    s.unacked_count,
    s.failure_count,
    coalesce(d.sent_total, 0) as sent_total,
    coalesce(d.acked_total, 0) as acked_total
  from public.push_subscriptions s
  left join (
    select subscription_id,
           count(*) as sent_total,
           count(acked_at) as acked_total
    from public.push_deliveries
    where subscription_id is not null
    group by subscription_id
  ) d on d.subscription_id = s.id
  order by s.user_id, s.id;
$function$;


-- -------------------------------------------------------------
-- Cleanup of things this schema no longer needs.
--
-- on_bust_insert(): orphaned. No trigger has referenced it since
-- enforce_bust_cooldown took over maintaining profiles.last_bust_timestamp,
-- which it does under a `for update` lock the older function never held.
--
-- reconcile_achievements(): a second, diverging copy of the achievement rules.
-- The client calls the reconcile-achievements EDGE FUNCTION, which computes
-- unlocks from src/rules.js; this SQL reimplementation was never updated for
-- the expansion catalog and its final `return query` had no `where user_id`,
-- so it returned every user's achievements to whoever called it. Two sources of
-- truth for the same rules is worse than one.
-- -------------------------------------------------------------
drop function if exists public.on_bust_insert();
drop function if exists public.reconcile_achievements();

-- Redundant: a unique index on (endpoint) already makes (user_id, endpoint)
-- unique, so this constraint can never be the one that fires. Dropping it also
-- removes a second index to maintain on every registration.
alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_user_id_endpoint_key;
