-- ============================================================
-- 63 A DATE RANGE SAYS WHAT IT LEFT OUT
--
-- A row with no date cannot satisfy "on or after 1 April". Postgres is
-- right to drop it -- null is not less than, not greater than, and not
-- equal to anything. But the screen then shows a total that quietly
-- excludes rows that exist, and nothing says so. That is the same fault
-- as a counter reading zero on a full table: the number is not wrong,
-- the silence is.
--
-- So the screen can now ask a second question with the same filters:
-- how many rows match everything EXCEPT the date, and have no date at
-- all? When that is more than nothing, the screen says so in words
-- rather than leaving a person to notice the arithmetic.
--
-- p_undated_only is a new argument rather than a new function, because a
-- second function would be a second copy of the matching rules, and two
-- copies of a rule is how a count stops agreeing with the rows it
-- counted. The old shape is dropped in the same transaction as the new
-- one is created, so there is never a moment with neither or both.
--
-- ON TODAY'S DATA THIS REPORTS ZERO, and that is worth writing down.
-- Price history is scoped to kind='item', and every one of the 22,902
-- item rows has a date. The 1,447 rows with no date are all opening
-- balances, which are undated by design and never in this scope. The
-- guard is here for the ledger screen, where opening balances DO belong,
-- and for the next import that brings an item row without a date.
-- ============================================================

drop function if exists public.busy_search_count(text, text, text, text[], date, date);

create function public.busy_search_count(
  p_company       text,
  p_query         text default null,
  p_party         text default null,
  p_doc_types     text[] default null,
  p_date_from     date default null,
  p_date_to       date default null,
  p_undated_only  boolean default false)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_n       bigint;
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

  with q as (
    select public.busy_numbers(p_query) as nums
  ),
  scoped as (
    select h.search_text, h.search_norm, h.search_comp, h.search_words
    from public.busy_history h
    where h.company = p_company
      and h.kind = 'item'
      and h.deleted_at is null
      and (p_party     is null or h.party = p_party)
      and (p_doc_types is null or h.doc_type = any(p_doc_types))
      -- Asked one way or the other, never both: either the rows inside the
      -- range, or the rows the range can never hold because they have no
      -- date to compare.
      and (case when p_undated_only then h.vch_date is null
                else (p_date_from is null or h.vch_date >= p_date_from)
                 and (p_date_to   is null or h.vch_date <= p_date_to) end)
  ),
  judged as (
    select
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
  select count(*) into v_n
  from judged j
  where v_raw = ''
     or (coalesce(j.numbers_ok, true)
         and (j.hit_exact or j.hit_cleaned or j.hit_fuzzy or j.hit_split));

  return v_n;
end;
$function$;

revoke all on function public.busy_search_count(text, text, text, text[], date, date, boolean) from public, anon;
grant execute on function public.busy_search_count(text, text, text, text[], date, date, boolean) to authenticated, service_role;

comment on function public.busy_search_count(text, text, text, text[], date, date, boolean) is
  'How many rows busy_search would return for the same filters. With p_undated_only the date range is replaced by "has no date at all", so the screen can say how many rows a range left out instead of quietly shrinking. Same four layers, through the same functions, so the count and the rows cannot drift apart.';
