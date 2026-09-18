-- ============================================================
-- 52 THE SCREEN ASKS WHICH VOUCHER TYPES EXIST
--
-- The tickboxes were a list of five, written into busy.html. The parser is
-- about to start reading six more -- receipts, payments and the opening
-- balances out of Folio1 -- and a type that is in the data but not in that
-- list would be INVISIBLE: no tickbox, so no way to see those rows, and
-- nothing on screen to say they were there.
--
-- A hand-kept list of what the data contains is one more thing that drifts
-- from the data. So the screen asks.
-- ============================================================

create or replace function public.busy_doc_types(p_company text)
returns table (doc_type text, rows bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;

  return query
  select h.doc_type, count(*)::bigint
  from public.busy_history h
  where h.company = p_company
    and h.kind = 'item'            -- the price screen shows item rows
    and h.deleted_at is null
    and coalesce(h.doc_type,'') <> ''
  group by h.doc_type
  order by count(*) desc, h.doc_type;
end;
$$;

revoke all on function public.busy_doc_types(text) from public, anon;
grant execute on function public.busy_doc_types(text) to authenticated, service_role;

comment on function public.busy_doc_types(text) is
  'Which voucher types this firm actually has, so the tickboxes on the price screen come from the data rather than from a list somebody has to remember to update. A type in the data with no tickbox would be invisible.';