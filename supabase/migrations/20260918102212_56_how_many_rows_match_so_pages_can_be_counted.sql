-- ============================================================
-- 56 HOW MANY ROWS MATCH, SO PAGES CAN BE COUNTED
--
-- The price screen had a page SIZE and no pagination: you could say 25 a
-- page and never reach row 26. To show "page 2 of 14" the screen has to
-- know how many rows match in total, and busy_search returns only the page
-- it was asked for.
--
-- A NEW FUNCTION, not a new column on busy_search. Changing what
-- busy_search returns means dropping and recreating it, and a page still
-- holding the old copy would break the moment the old shape went -- which
-- is exactly what happened with p_doc_type and is written up in docs/23 as
-- "a change that spans two places happens in three steps". Adding a
-- separate function changes nothing that is already deployed.
--
-- The filters are the same ones busy_search takes, in the same order, so
-- the count is of the same rows.
-- ============================================================

create or replace function public.busy_search_count(
  p_company   text,
  p_query     text default null,
  p_party     text default null,
  p_doc_types text[] default null,
  p_date_from date default null,
  p_date_to   date default null)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare v_n bigint;
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS. The menu path decides it, not a filter.'
      using errcode = 'check_violation';
  end if;

  with q as (
    select btrim(coalesce(p_query,''))    as raw,
           public.busy_normalise(p_query) as nq,
           public.busy_numbers(p_query)   as nums
  ),
  scoped as (
    select h.search_text,
           public.busy_normalise(h.search_text) as norm,
           public.busy_compact(h.search_text)   as comp
    from public.busy_history h
    where h.company = p_company
      and h.kind = 'item'
      and h.deleted_at is null
      and (p_party     is null or h.party = p_party)
      and (p_doc_types is null or h.doc_type = any(p_doc_types))
      and (p_date_from is null or h.vch_date >= p_date_from)
      and (p_date_to   is null or h.vch_date <= p_date_to)
  ),
  judged as (
    select
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
      q.raw as raw
    from scoped s, q
  )
  select count(*) into v_n
  from judged j
  where j.raw = ''
     or (coalesce(j.numbers_ok, true)
         and (j.hit_exact or j.hit_cleaned or j.hit_fuzzy));

  return v_n;
end;
$function$;

revoke all on function public.busy_search_count(text, text, text, text[], date, date) from public, anon;
grant execute on function public.busy_search_count(text, text, text, text[], date, date) to authenticated, service_role;

comment on function public.busy_search_count(text, text, text, text[], date, date) is
  'How many rows a price-history search matches in total, so the screen can say "page 2 of 14". Same filters and same matching as busy_search, so it counts the same rows.';