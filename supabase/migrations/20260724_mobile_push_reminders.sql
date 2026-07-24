-- Mobile-first web push reminders (standardized cadence, no user-configurable quiet hours/preferences)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

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

create index if not exists inactivity_reminders_scheduled_idx on public.inactivity_reminders(scheduled_for);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
alter table public.inactivity_reminders enable row level security;

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
for select to authenticated using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions
for insert to authenticated with check (user_id = auth.uid());

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
for delete to authenticated using (user_id = auth.uid());

-- Reminder state is server-managed only; clients read reminders through push delivery.

create or replace function public.reset_inactivity_reminder_on_bust()
returns trigger
language plpgsql
security definer
set search_path = public
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

do $$
declare
  fn_base text := current_setting('app.settings.supabase_functions_url', true);
  service_role text := current_setting('app.settings.service_role_key', true);
begin
  if fn_base is null or service_role is null then
    return;
  end if;

  begin
    perform extensions.cron.unschedule('dispatch-inactivity-reminders');
  exception when others then
    null;
  end;

  perform extensions.cron.schedule(
    'dispatch-inactivity-reminders',
    '*/15 * * * *',
    format($cron$
      select extensions.net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', %L
        ),
        body := '{}'::jsonb
      ) as request_id;
    $cron$, fn_base || '/dispatch-inactivity-reminders', 'Bearer ' || service_role)
  );
exception
  when undefined_function or invalid_schema_name or undefined_table then
    null;
end;
$$;
