-- ============================================================
-- 62 EVERY TABLE IS REACHABLE ON PURPOSE, OR NOT AT ALL
--
-- 61 fixed busy_history: a read policy with no SELECT grant behind it, so
-- every read was refused before the policy was ever consulted. Asking the
-- same question of all 88 tables at once -- the set check, not the one
-- table -- turned up four more, in two other shapes. None of them is the
-- same fault, and all four are worth closing while the question is open.
--
-- NO ROW SECURITY AT ALL, AND GRANTED TO EVERY SIGNED-IN PERSON
--   busy_history_changes   holds the old and new value of every Busy row
--                          that changed -- prices, parties, amounts
--   busy_financial_years   which years each firm has, and when last seen
--
-- Busy data is not open to ordinary staff: busy_history says so in a
-- policy, and busy_fy_status asks for busy_data.view. Both of those are
-- worth nothing while the tables underneath them can be read directly.
-- They get the same policy busy_history has, which is the one Raghbir
-- already agreed: busy_data.view, or the owner.
--
-- The two views over these tables are not security_invoker, so they run
-- as their owner and keep working exactly as before; they do their own
-- permission check, which is why the check has to be on the table too.
--
-- GRANTED, BUT WITH NO POLICY TO LET ANYTHING THROUGH
--   job_secrets            the nightly backup's key
--   busy_import_staging    rows waiting to be compared, mid-import
--
-- These two were never a leak -- row-level security is on and there is no
-- policy, so a signed-in person gets nothing. But a grant that lets you
-- reach a table you can never read anything from is a sentence that says
-- nothing, and the next person to read it has to work that out again.
-- Both are reached through SECURITY DEFINER functions or by the backup
-- running as service_role, neither of which needs this grant. Removed, so
-- the intent is on the page.
-- ============================================================

alter table public.busy_history_changes enable row level security;
drop policy if exists busy_history_changes_read on public.busy_history_changes;
create policy busy_history_changes_read on public.busy_history_changes
  for select to authenticated
  using (public.has_permission('busy_data.view') or public.is_owner());

alter table public.busy_financial_years enable row level security;
drop policy if exists busy_financial_years_read on public.busy_financial_years;
create policy busy_financial_years_read on public.busy_financial_years
  for select to authenticated
  using (public.has_permission('busy_data.view') or public.is_owner());

comment on table public.busy_history_changes is
  'What changed in a Busy row, old value beside new. Reachable only by someone who may see Busy data: it holds the same prices and parties busy_history does, so a weaker rule here would be the way round the rule there.';

revoke select, insert, update, delete on public.job_secrets from authenticated;
revoke select, insert, update, delete on public.busy_import_staging from authenticated;
