-- ============================================================
-- 17 TWO FIXES THE FIRST BACKUP RUN EXPOSED
-- ============================================================

-- (1) The backup was copying the table that holds the backup job's own
--     secret, and the short-lived two-step login codes, into the bundle.
--     Neither belongs in a backup. Exclude them at the source, so no
--     future job can pick them up by accident either.
create or replace function public.list_public_tables()
returns table (table_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname not in ('job_secrets','two_step_codes')
  order by c.relname
$$;

revoke all on function public.list_public_tables() from public, anon, authenticated;

comment on function public.list_public_tables() is
  'Tables the nightly backup should copy. job_secrets and two_step_codes are deliberately left out -- a backup must never carry the keys to itself.';

-- (2) Supabase no longer allows deleting rows from storage.objects directly,
--     so retention of the stored bundles moves to the backup function, which
--     goes through the Storage API. This function now only ages out the log.
create or replace function public.prune_backup_runs()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_months int;
  v_marked int;
begin
  select coalesce(backup_retention_months, 12) into v_months from public.app_settings where id = 1;

  update public.backup_runs
     set status = 'cancelled',
         error_message = coalesce(error_message, '') || ' [aged out of the 12-month window]'
   where run_date < (current_date - make_interval(months => v_months))::date
     and status <> 'cancelled';

  get diagnostics v_marked = row_count;
  return v_marked;
end;
$$;

revoke all on function public.prune_backup_runs() from public, anon, authenticated;

comment on function public.prune_backup_runs() is
  'Ages out old rows in the backup log. Deleting the stored bundles themselves is done by the nightly-backup function through the Storage API.';
