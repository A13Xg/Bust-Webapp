-- =============================================================
-- profiles.username carried two unique constraints: the plain
-- `username unique` from the original table definition, and
-- `profiles_username_lower_key` (unique on lower(username)), added in
-- 20260908010000_username_case_insensitive.sql to make usernames one
-- identity regardless of case.
--
-- The plain constraint is provably redundant now: any two rows that
-- violate `unique(username)` (identical strings) also violate
-- `unique(lower(username))`, and the lower() index additionally catches
-- case-variant collisions the plain constraint misses entirely. Nothing
-- in RLS, foreign keys, or application code references it by name or
-- relies on it specifically — signup's duplicate-detection already keys
-- off the generic 23505 unique-violation SQLSTATE, not which constraint
-- fired.
--
-- Repeatable: safe to run multiple times.
-- =============================================================

alter table public.profiles drop constraint if exists profiles_username_key;
