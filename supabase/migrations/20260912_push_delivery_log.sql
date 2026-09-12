-- =============================================================
-- BUST — push delivery log
--
-- `push_subscriptions.last_success_at` records that a push service ACCEPTED a
-- message, which is all web push tells the server: there is no delivery receipt
-- in the protocol. The only party that knows a notification actually arrived is
-- the device, so the service worker acknowledges it.
--
--   * one row per (batch, subscription) at send time
--   * `receipt_id` travels inside the push payload and comes back from the
--     service worker, which stamps `acked_at`
--
-- `receipt_id` is the whole authorisation for that callback: the service worker
-- has no Supabase session to authenticate with, so ack-push is unauthenticated
-- and an unguessable per-delivery UUID is what stops anyone marking someone
-- else's notification received. It grants nothing but "set one timestamp", and
-- ack-push returns 204 whether or not the id existed so it cannot be probed.
--
-- Retention: a crew this size writes a few dozen rows a day. Left to grow on
-- purpose — the running log in the debug menu is the point. Prune by hand if it
-- ever matters.
--
-- Repeatable: safe to run multiple times.
-- =============================================================

create table if not exists public.push_deliveries (
  id bigint generated always as identity primary key,
  receipt_id uuid not null default gen_random_uuid(),
  -- One sendToSubscriptions() call. Groups the fan-out of a single event so the
  -- report can say "this bust went to 4 devices, 3 confirmed".
  batch_id uuid not null,
  kind text not null,
  -- Whoever caused the notification. Null for a system nag with no actor, and
  -- set null rather than cascading on delete so the log survives the account.
  actor_id uuid references public.profiles(id) on delete set null,
  recipient_id uuid references public.profiles(id) on delete cascade,
  title text not null default '',
  sent_at timestamptz not null default now(),
  acked_at timestamptz,
  unique (receipt_id)
);

create index if not exists push_deliveries_batch_idx on public.push_deliveries (batch_id);
create index if not exists push_deliveries_sent_idx on public.push_deliveries (sent_at desc);

-- Service-role only, exactly like push_events: RLS on with zero policies is a
-- complete deny for anon and authenticated, and the service role bypasses RLS.
-- Clients reach this table only through push-delivery-report, which is behind
-- the admin allowlist — the log says who received what, which is not crew-wide
-- readable information.
alter table public.push_deliveries enable row level security;
