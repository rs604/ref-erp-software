-- Runtime discovery helper for the nightly-backup edge function.
-- Returns the name of every ordinary base table in schema public, so the
-- backup function never has to hardcode a table list (new tables are picked
-- up automatically on the next nightly run).
create or replace function public.list_public_tables()
returns table (table_name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'          -- ordinary base tables only (no views/matviews)
  order by c.relname
$$;

revoke all on function public.list_public_tables() from public, anon, authenticated;
grant execute on function public.list_public_tables() to service_role;

comment on function public.list_public_tables() is
  'Lists public base tables. Used by the nightly-backup edge function for runtime table discovery. service_role only.';