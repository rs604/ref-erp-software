-- ============================================================
-- 16 SCHEDULE THE BACKUP
-- The job authenticates itself with a secret that lives in the database
-- and nowhere else, so there is nothing for anyone to set up by hand.
-- ============================================================

create table public.job_secrets (
  key        text primary key,
  secret     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  note       text
);

alter table public.job_secrets enable row level security;
-- No policies at all: no screen, signed in or not, can read this table.
-- Only the service key (used by the edge functions) and the scheduler can.

comment on table public.job_secrets is
  'Shared secrets for the database''s own scheduled jobs. Deliberately unreadable from every screen.';

insert into public.job_secrets (key, secret, note)
values ('nightly-backup', encode(extensions.gen_random_bytes(32), 'hex'),
        'Sent by the scheduler as the x-backup-secret header and checked by the nightly-backup function.');

create or replace function public.job_secret(p_key text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select secret from public.job_secrets where key = p_key
$$;

revoke all on function public.job_secret(text) from public, anon, authenticated;

-- ---------- The schedule ----------
-- 02:00 every night in Ludhiana = 20:30 UTC the day before.
select cron.schedule(
  'nightly-backup',
  '30 20 * * *',
  $job$
  select extensions.http_post(
    url     := 'https://deevokrufinihutrvnqw.supabase.co/functions/v1/nightly-backup',
    body    := '{"source":"pg_cron"}'::jsonb,
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'x-backup-secret', public.job_secret('nightly-backup')
               ),
    timeout_milliseconds := 300000
  );
  $job$
);
