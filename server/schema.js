export const SCHEMA_SQL = `
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null check (length(username) between 2 and 32),
  synthetic_email text unique not null,
  password_hash text not null,
  avatar_seed text not null,
  created_at timestamptz not null default now(),
  last_bust_timestamp timestamptz,
  tagline text,
  showcase text
);
alter table users add column if not exists tagline text;
alter table users add column if not exists showcase text;
create table if not exists busts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  timestamp timestamptz not null default now(),
  note text,
  temp_f numeric,
  pressure numeric,
  lat numeric,
  long numeric,
  city text,
  elevation_ft numeric,
  time_bucket text not null
);
alter table busts add column if not exists elevation_ft numeric;
create table if not exists achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  achievement_type text not null,
  unlocked_at timestamptz not null default now(),
  unique(user_id, achievement_type)
);
create index if not exists busts_timestamp_idx on busts(timestamp desc);
create index if not exists busts_user_timestamp_idx on busts(user_id, timestamp desc);
`;
