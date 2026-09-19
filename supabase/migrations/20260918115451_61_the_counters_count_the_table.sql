-- ============================================================
-- 61 THE COUNTERS COUNT THE TABLE, AND A REFUSED READ IS NOT A ZERO
--
-- Raghbir was told to check the 98,644-row load against three numbers on
-- the Load history screen. All three read ZERO while the table held every
-- row. A number whose only job is to say whether the load worked, and
-- which reads zero on a full table, is worse than no number at all.
--
-- WHAT WAS ACTUALLY WRONG -- AND IT IS NOT WHAT IT LOOKED LIKE
-- The counters were not counting batch records. They read
-- busy_history_ref and busy_history_rs, which are views over
-- busy_history, with count(*). That is counting the table.
--
-- They read zero because THE READ WAS REFUSED and the screen turned the
-- refusal into a number. busy_history has a row-level policy letting a
-- signed-in person with busy_data.view read it -- and the SELECT grant
-- that policy needs was never given. So the policy could never be
-- reached, both views are security_invoker, and every signed-in person,
-- Raghbir included, got "permission denied for table busy_history".
-- The screen took the failure, wrote `r.count || 0`, and showed 0.
--
-- One table in the whole project is in that state. The check for it is
-- in tests/check-rls-grants.sql: a read policy for `authenticated` with
-- no SELECT grant behind it is a rule written and never applied.
--
-- THREE THINGS CHANGE HERE
--
-- 1. The grant is given, so the policy that was written is the policy
--    that runs, and the two views work for the people they were built
--    for.
--
-- 2. The counts come from one function that counts busy_history itself,
--    by company and by kind -- what is actually in there, not what any
--    batch record claims. This is convention 6 in docs/12 applied to a
--    count: balances are derived from the documents, never typed in, and
--    a count taken from a batch record rather than from the rows is the
--    same mistake.
--
-- 3. The expected figures move out of three columns on the settings row
--    and into a table keyed by company and kind. Three columns could not
--    hold six figures, and kind='opening' arrived this month -- the next
--    kind would have needed another migration. The TOTAL is not stored
--    at all: it is the sum of the parts, so it can never disagree with
--    them.
-- ============================================================

-- ---------- 1. the policy that was never reachable ----------
grant select on public.busy_history to authenticated;

-- ---------- 2. what each company and kind should hold ----------
create table if not exists public.busy_expected_rows (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  status      public.record_status default 'approved',

  company     text not null check (company in ('REF','RS')),
  kind        text not null check (kind in ('item','ledger','opening')),
  rows        integer not null check (rows >= 0),
  note        text
);

create unique index if not exists busy_expected_rows_one_per_kind_idx
  on public.busy_expected_rows (company, kind);

comment on table public.busy_expected_rows is
  'What Busy says each company and kind should hold, so a load can be checked against a number Raghbir set rather than against nothing. The figures are typed in because they come from Busy; the counts they are compared with are never typed in.';
comment on column public.busy_expected_rows.rows is
  'Expected row count for this company and kind. The total across all of them is never stored -- it is added up, so it cannot disagree with its parts.';

alter table public.busy_expected_rows enable row level security;

drop policy if exists busy_expected_rows_read on public.busy_expected_rows;
create policy busy_expected_rows_read on public.busy_expected_rows
  for select to authenticated
  using (public.has_permission('busy_data.view') or public.is_owner());

drop policy if exists busy_expected_rows_write on public.busy_expected_rows;
create policy busy_expected_rows_write on public.busy_expected_rows
  for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

grant select on public.busy_expected_rows to authenticated;
grant insert, update, delete on public.busy_expected_rows to authenticated;

insert into public.busy_expected_rows (company, kind, rows, note) values
  ('REF','item',    21470, 'From the 98,644-row file, 18 Sep 2026'),
  ('REF','ledger',  67763, 'From the 98,644-row file, 18 Sep 2026'),
  ('REF','opening',  1065, 'From the 98,644-row file, 18 Sep 2026'),
  ('RS','item',      1432, 'From the 98,644-row file, 18 Sep 2026'),
  ('RS','ledger',    6532, 'From the 98,644-row file, 18 Sep 2026'),
  ('RS','opening',    382, 'From the 98,644-row file, 18 Sep 2026')
on conflict (company, kind) do update
  set rows = excluded.rows, note = excluded.note, updated_at = now();

-- ---------- 3. the count, taken from the rows ----------
create or replace function public.busy_row_counts()
returns table (company text, kind text, rows bigint, expected integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A full join, so a kind that is expected but has arrived as nothing
  -- still appears -- as 0 of 1,065, which is the whole point. A kind
  -- present but not expected appears too, with no expected figure, so a
  -- new kind announces itself rather than hiding.
  return query
  select coalesce(a.company, e.company) as company,
         coalesce(a.kind,    e.kind)    as kind,
         coalesce(a.n, 0)               as rows,
         e.rows                         as expected
  from (select h.company, h.kind, count(*) as n
          from public.busy_history h
         where h.deleted_at is null
         group by h.company, h.kind) a
  full join public.busy_expected_rows e
    on e.company = a.company and e.kind = a.kind
  order by 1, 2;
end;
$function$;

revoke all on function public.busy_row_counts() from public, anon;
grant execute on function public.busy_row_counts() to authenticated, service_role;

comment on function public.busy_row_counts() is
  'What busy_history actually holds, by company and kind, beside what it is expected to hold. Counted from the rows themselves: never from a batch record, which can say a load finished while the rows are not there.';

-- ---------- the three columns this replaces ----------
-- Three columns could not hold six figures, and a stored total is a
-- number that can disagree with its own parts.
alter table public.busy_sync_settings
  drop column if exists expected_item_rows_ref,
  drop column if exists expected_item_rows_rs,
  drop column if exists expected_total_rows;
