-- ============================================================
-- 51 THE SEARCH TAKES A LIST OF VOUCHER TYPES, NOT ONE
--
-- The screen had a dropdown: one type, or all. A dropdown hides what is
-- chosen until you open it, and on a screen whose whole job is "what did
-- we pay for this", the type you are looking at matters enough to be
-- visible without opening anything. So the screen now shows tickboxes,
-- which means the search has to accept more than one type.
--
-- p_doc_type (one) is REPLACED by p_doc_types (a list). Not added
-- alongside it: two ways to say the same thing is how call sites drift,
-- and PostgREST could not tell which function a call meant if both
-- existed. The old one is dropped in the same transaction as the new one
-- is created, so there is never a moment with neither or both.
--
-- Nothing else in the function changes.
-- ============================================================

drop function if exists public.busy_search(text, text, text, text, date, date, integer, integer);

create function public.busy_search(
  p_company   text,
  p_query     text default null,
  p_party     text default null,
  p_doc_types text[] default null,
  p_date_from date default null,
  p_date_to   date default null,
  p_limit     integer default 200,
  p_offset    integer default 0)
returns table (id uuid, company text, fy text, doc_type text, vch_no text,
               vch_date date, party text, item text, description text,
               qty numeric, rate numeric, amount numeric, is_lump_sum boolean,
               is_extreme_rate boolean, median_rate numeric, match_tier integer)
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
    raise exception 'A company must be named, and it must be REF or RS. The menu path decides it, not a filter.'
      using errcode = 'check_violation';
  end if;

  return query
  with q as (
    select btrim(coalesce(p_query,''))    as raw,
           public.busy_normalise(p_query) as nq,
           public.busy_numbers(p_query)   as nums,
           (select extreme_rate_multiple from public.busy_sync_settings where id = 1) as mult,
           (select extreme_rate_min_rows from public.busy_sync_settings where id = 1) as minrows
  ),
  scoped as (
    select h.*, public.busy_normalise(h.search_text) as norm,
                public.busy_compact(h.search_text)   as comp
    from public.busy_history h
    where h.company = p_company
      and h.kind = 'item'          -- a ledger posting is not a price
      and h.deleted_at is null
      and (p_party     is null or h.party = p_party)
      -- An empty list means the person has unticked everything, which is a
      -- request for nothing, not a request for everything. Only null -- no
      -- filter sent at all -- means every type.
      and (p_doc_types is null or h.doc_type = any(p_doc_types))
      and (p_date_from is null or h.vch_date >= p_date_from)
      and (p_date_to   is null or h.vch_date <= p_date_to)
  ),
  judged as (
    select s.*,
      (select bool_and(s.norm ~ ('(^|[^0-9.])' || replace(n, '.', '\.') || '([^0-9.]|$)'))
         from unnest(q.nums) n) as numbers_ok,
      (q.raw <> '' and s.search_text ilike '%' || q.raw || '%') as hit_exact,
      (q.raw <> '' and
        (select bool_and(s.comp like '%' || public.busy_compact(w) || '%')
           from unnest(string_to_array(q.nq, ' ')) w
          where w <> '')) as hit_cleaned,
      (q.raw <> '' and cardinality(q.nums) = 0 and
        (select bool_and(exists (
            select 1 from unnest(string_to_array(s.norm, ' ')) rw
             where extensions.similarity(rw, w) > 0.5))
           from unnest(string_to_array(q.nq, ' ')) w
          where w <> '')) as hit_fuzzy,
      q.raw as raw, q.mult as mult, q.minrows as minrows
    from scoped s, q
  )
  select j.id, j.company, j.fy, j.doc_type, j.vch_no, j.vch_date,
         j.party, j.item, j.description, j.qty, j.rate, j.amount,
         j.is_lump_sum,
         (j.rate is not null and j.rate > 0
          and st.median_rate is not null
          and st.priced_rows >= j.minrows
          and j.rate > st.median_rate * j.mult) as is_extreme_rate,
         st.median_rate,
         case when j.raw = '' then 3
              when j.hit_exact then 1
              when j.hit_cleaned then 2
              else 3 end as match_tier
  from judged j
  left join public.busy_item_rate_stats st
         on st.company = j.company and st.item = j.item
  where j.raw = ''
     or (coalesce(j.numbers_ok, true)
         and (j.hit_exact or j.hit_cleaned or j.hit_fuzzy))
  order by match_tier, j.vch_date desc nulls last
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$function$;

revoke all on function public.busy_search(text, text, text, text[], date, date, integer, integer) from public, anon;
grant execute on function public.busy_search(text, text, text, text[], date, date, integer, integer) to authenticated, service_role;

comment on function public.busy_search(text, text, text, text[], date, date, integer, integer) is
  'Price history search. p_doc_types is a list because the screen shows tickboxes rather than a dropdown: null means every type, and an empty list means none, because unticking everything is a request for nothing.';