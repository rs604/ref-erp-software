-- ============================================================
-- 73 A NOTE THAT FIRES ON ONE RESULT IS WORSE THAN NO NOTE
--
-- His words, and they are the whole rule: "A note that fires on a single
-- result is worse than no note -- it teaches people to ignore the note,
-- and then they ignore the real one."
--
-- busy_similar_ledgers() answered for any string at all. Ask it about a
-- name Busy does not hold -- a typed "R.S. INDUSTRIES", say, which is a
-- third spelling of neither ledger -- and it returned BOTH real ones. The
-- screen would then have said "3 ledgers with nearly the same name" over
-- an empty ledger, counting a ledger that does not exist as one of them.
--
-- So: the ledger asked about must itself exist in that firm, or there is
-- nothing to say. The count on screen is then always the true number of
-- real ledgers, and it is never 1 -- because with nothing beside it the
-- function returns no rows and the screen prints nothing at all.
-- ============================================================

create or replace function public.busy_similar_ledgers(p_company text, p_ledger text)
returns table(ledger text, entries bigint)
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
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;

  -- The subject has to be a ledger Busy actually holds. Counting a name
  -- nobody has as one of the "ledgers with nearly the same name" is the
  -- exact overstatement this note must never make.
  if not exists (
    select 1 from public.busy_history h
    where h.company = p_company and h.deleted_at is null and h.ledger = p_ledger)
  then
    return;
  end if;

  return query
  select h.ledger, count(*) as entries
  from public.busy_history h
  where h.company = p_company
    and h.deleted_at is null
    and h.ledger is not null
    and h.ledger is distinct from p_ledger
    and public.busy_name_key(h.ledger) = public.busy_name_key(p_ledger)
  group by h.ledger
  order by h.ledger;
end;
$function$;

revoke all on function public.busy_similar_ledgers(text, text) from public;
grant execute on function public.busy_similar_ledgers(text, text) to authenticated;
