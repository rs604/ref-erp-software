-- ============================================================
-- 15 OUR OWN BACKUP
-- Supabase's own backups need the paid plan, keep only 7 days, and never
-- include uploaded files. So the database keeps its own: a job that runs
-- every night by itself and needs nothing from anybody.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.backup_runs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  status         public.record_status default 'draft',

  run_date       date not null default (now() at time zone 'Asia/Kolkata')::date,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,

  destination    text not null default 'storage'
                   check (destination in ('storage','github','both')),
  tables_count   int,
  rows_count     bigint,
  files_count    int,
  bytes_written  bigint,
  github_commit  text,
  error_message  text
);

comment on table public.backup_runs is
  'One row per nightly backup, so anyone can see at a glance that it ran and what it saved. status completed = it worked, cancelled = it failed.';

create index backup_runs_date_idx on public.backup_runs (run_date desc);

alter table public.backup_runs enable row level security;
create policy backup_runs_read on public.backup_runs for select to authenticated
  using (public.has_permission('admin.audit') or public.is_owner());

select public.attach_conventions('backup_runs');

-- A private bucket for the nightly bundle, so there is always a second copy
-- even before the GitHub side is switched on.
insert into storage.buckets (id, name, public, file_size_limit)
values ('backups', 'backups', false, 524288000)
on conflict (id) do update set public = false;

-- ---------- Keep 12 months, drop what is older ----------
create or replace function public.prune_backup_runs()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_months int;
  v_deleted int;
begin
  select coalesce(backup_retention_months, 12) into v_months from public.app_settings where id = 1;

  delete from storage.objects
   where bucket_id = 'backups'
     and created_at < now() - make_interval(months => v_months);
  get diagnostics v_deleted = row_count;

  update public.backup_runs
     set status = 'cancelled', error_message = coalesce(error_message, 'pruned: older than retention window')
   where run_date < (current_date - make_interval(months => v_months))::date
     and status <> 'cancelled';

  return v_deleted;
end;
$$;

revoke all on function public.prune_backup_runs() from public, anon, authenticated;

comment on function public.prune_backup_runs() is
  'Deletes backup bundles older than app_settings.backup_retention_months (12 by default). GitHub history is pruned by the backup function itself.';
