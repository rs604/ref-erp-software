-- ==============================================================================
-- 82 HOW MANY ARE HIDING UNDER THE OTHER TICKBOXES
--
-- The screen opens with Sales Invoice ticked and nothing else. That is right
-- for what he sells and silently wrong for everything he buys:
--
--     pipe   under Sales Invoice      64
--     pipe   under Purchase Bill   1,150
--
-- 1,150 rows were one unticked box away and the screen gave no sign they
-- existed. A filter that hides rows must say how many it is hiding.
--
-- So the count comes back PER TYPE, for the query and date range actually
-- typed, and goes on the tickboxes themselves.
--
-- IT REPLACES A CALL RATHER THAN ADDING ONE. busy_search_count(p_undated_only
-- => false) counted the chosen types; the total is now the sum of the chosen
-- types' numbers here, so the screen makes the same number of round trips as
-- before and gets the chip numbers for nothing. The predicate below is
-- busy_search_count's, word for word, minus p_doc_types -- counting every
-- type is the whole point -- so the two can never disagree about what
-- matches.
-- ==============================================================================

create or replace function public.busy_type_counts(
  p_company   text,
  p_query     text default null,
  p_party     text default null,
  p_date_from date default null,
  p_date_to   date default null)
returns table (doc_type text, n bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_raw     text;
  v_words   text[];
  v_cwords  text[];
  v_ewords  text[];
  v_ecwords text[];
  v_split   boolean := false;
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS. The menu path decides it, not a filter.'
      using errcode = 'check_violation';
  end if;

  v_raw   := btrim(coalesce(p_query, ''));
  v_words := array_remove(string_to_array(public.busy_normalise(p_query), ' '), '');
  select coalesce(array_agg(public.busy_compact(w) order by o), '{}')
    into v_cwords from unnest(v_words) with ordinality t(w, o);

  if v_raw <> '' and exists (select 1 from unnest(v_words) w
                             where w !~ '[0-9]' and length(w) >= 6) then
    v_ewords := public.busy_split_query(p_company, v_words);
    v_split  := v_ewords is distinct from v_words;
  end if;
  if v_split then
    select coalesce(array_agg(public.busy_compact(w) order by o), '{}')
      into v_ecwords from unnest(v_ewords) with ordinality t(w, o);
  end if;

  return query
  with q as (
    select public.busy_numbers(p_query) as nums
  ),
  scoped as (
    select h.doc_type, h.search_text, h.search_norm, h.search_comp, h.search_words
    from public.busy_history h
    where h.company = p_company
      and h.kind = 'item'
      and h.deleted_at is null
      and h.doc_type is not null
      and (p_party is null or h.party = p_party)
      -- The undated rows are left out for the same reason the table leaves
      -- them out: a row with no date cannot be inside any range. With no
      -- range set there is nothing to exclude and the two clauses are null.
      and (p_date_from is null or h.vch_date >= p_date_from)
      and (p_date_to   is null or h.vch_date <= p_date_to)
  ),
  judged as (
    select
      s.doc_type,
      (select bool_and(s.search_norm ~ ('(^|[^0-9.])' || replace(n, '.', '\.') || '([^0-9.]|$)'))
         from unnest(q.nums) n) as numbers_ok,
      (v_raw <> '' and s.search_text ilike '%' || v_raw || '%') as hit_exact,
      (v_raw <> '' and
        (select bool_and(s.search_comp like '%' || t.cw || '%')
           from unnest(v_words, v_cwords) as t(w, cw))) as hit_cleaned,
      (case when v_split or v_raw = '' then false
            else (select bool_and(public.busy_word_matches(s.search_words, s.search_comp, t.w, t.cw))
                    from unnest(v_words, v_cwords) as t(w, cw)) end) as hit_fuzzy,
      (case when v_split then
        (select bool_and(public.busy_word_matches(s.search_words, s.search_comp, t.w, t.cw))
           from unnest(v_ewords, v_ecwords) as t(w, cw))
       else false end) as hit_split
    from scoped s, q
  )
  select j.doc_type, count(*) as n
  from judged j
  where v_raw = ''
     or (coalesce(j.numbers_ok, true)
         and (j.hit_exact or j.hit_cleaned or j.hit_fuzzy or j.hit_split))
  group by j.doc_type
  order by j.doc_type;
end;
$function$;

revoke all on function public.busy_type_counts(text, text, text, date, date) from public;
grant execute on function public.busy_type_counts(text, text, text, date, date) to authenticated;