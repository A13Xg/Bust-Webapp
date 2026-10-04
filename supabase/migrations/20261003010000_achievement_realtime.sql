-- Keep earned history and social comparisons current in open clients.
-- The baseline publication includes busts and profiles but not achievements.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'achievements'
  ) then
    alter publication supabase_realtime add table public.achievements;
  end if;
end $$;
