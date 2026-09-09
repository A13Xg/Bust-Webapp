-- Every stored achievement must be defined by the catalog.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'achievements_achievement_type_fkey'
      and conrelid = 'public.achievements'::regclass
  ) then
    alter table public.achievements
      add constraint achievements_achievement_type_fkey
      foreign key (achievement_type)
      references public.achievement_catalog(id);
  end if;
end;
$$;