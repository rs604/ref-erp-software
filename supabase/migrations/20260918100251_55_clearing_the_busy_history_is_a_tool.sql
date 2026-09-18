-- ============================================================
-- 55 CLEARING THE BUSY HISTORY IS A TOOL, NOT A ONE-OFF
--
-- The history was cleared once by hand for the reload. That is fine once.
-- Twice is a habit of asking somebody else to run a DELETE on your data,
-- and the second time nobody writes down what it removed.
--
-- So: two functions. One SAYS what would go. One DOES it and reports what
-- went. The screen shows the first, makes the person confirm, then calls
-- the second.
--
-- OWNER ONLY. Not busy_data.import -- loading a year is ordinary work and
-- is guarded by the whole-year comparison; emptying twelve years of
-- history is not, and nothing in the import guards it.
--
-- WHAT IS KEPT, DELIBERATELY: busy_import_batches. That is the record of
-- every load ever attempted, including the ones that were refused and why.
-- Clearing the data should not clear the account of what happened to it.
-- ============================================================

create or replace function public.busy_clear_preview()
returns table (
  history_rows    bigint,
  ref_rows        bigint,
  rs_rows         bigint,
  years           bigint,
  change_records  bigint,
  staged_rows     bigint,
  batches_kept    bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can clear the Busy history.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select (select count(*) from public.busy_history),
         (select count(*) from public.busy_history where company = 'REF'),
         (select count(*) from public.busy_history where company = 'RS'),
         (select count(*) from public.busy_financial_years),
         (select count(*) from public.busy_history_changes),
         (select count(*) from public.busy_import_staging),
         (select count(*) from public.busy_import_batches);
end;
$$;

revoke all on function public.busy_clear_preview() from public, anon;
grant execute on function public.busy_clear_preview() to authenticated;

comment on function public.busy_clear_preview() is
  'What clearing the Busy history would remove, so the screen can name it before anyone is asked to agree to it. Changes nothing.';


create or replace function public.busy_clear_history(p_confirm text)
returns table (
  history_removed bigint,
  years_removed   bigint,
  changes_removed bigint,
  staged_removed  bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '120s'
as $$
declare v_h bigint; v_y bigint; v_c bigint; v_s bigint;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can clear the Busy history.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The screen asks the person to type this. A mis-click cannot reach here.
  if coalesce(p_confirm,'') <> 'CLEAR' then
    raise exception 'The Busy history was not cleared. To clear it, the word CLEAR has to be typed in full.'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_h from public.busy_history;
  select count(*) into v_y from public.busy_financial_years;
  select count(*) into v_c from public.busy_history_changes;
  select count(*) into v_s from public.busy_import_staging;

  -- Order matters: the change records point at the history rows.
  delete from public.busy_history_changes;
  delete from public.busy_history;
  delete from public.busy_import_staging;
  -- The year list too, or the Deleted screen shows twelve years holding
  -- nothing and calls some of them frozen.
  delete from public.busy_financial_years;

  -- busy_import_batches is NOT touched. It is the account of what was
  -- loaded and what was refused, and it outlives the data.

  history_removed := v_h;
  years_removed   := v_y;
  changes_removed := v_c;
  staged_removed  := v_s;
  return next;
end;
$$;

revoke all on function public.busy_clear_history(text) from public, anon;
grant execute on function public.busy_clear_history(text) to authenticated;

comment on function public.busy_clear_history(text) is
  'Empties the Busy history, the change records, the landing strip and the year list, and reports what it removed. Owner only, and refuses unless the word CLEAR is passed in full. The record of past loads in busy_import_batches is deliberately kept.';