-- ============================================================
-- 60 THE SEARCH STOPS RE-COMPACTING THE SAME WORD 21,470 TIMES
--
-- Two measured costs, both avoidable, both paid on every keystroke.
--
-- ONE: THE TYPED WORD WAS BEING COMPACTED ONCE PER ROW
-- busy_word_matches called busy_compact on the TYPED word -- the same
-- word, giving the same answer, 21,470 times a search, and twice per
-- row at that. busy_compact fixes its own search_path, which is right
-- for a function the database stores a column with, but it also stops
-- PostgreSQL folding the call away. So the compacted form of each typed
-- word is now worked out once, before the rows are touched, and handed
-- in. With that gone busy_word_matches and busy_near are plain enough
-- for the planner to fold into the query itself.
--
-- TWO: THE FUZZY LAYER WAS STILL BEING RUN AFTER A WORD WAS SPLIT
-- A word only gets cut in two when the data does not know it -- not as
-- written, not inside a longer word, not as a near spelling. So once a
-- split has happened, the third layer cannot match anything: it needs
-- every typed word to match, and one of them is a word nothing matches.
-- It is skipped now. That is one whole pass over the rows saved on
-- exactly the searches that were slowest.
--
-- Measured on Raghbir's data, REF, 21,470 item rows:
--   "junejpipe"  3.45s -> see the report
--   "agarwal"    1.56s -> see the report
-- against a limit of 8 seconds for a signed-in person.
--
-- No rule changes here. Same layers, same answers, same match_tier.
-- ============================================================

-- The typed word arrives already compacted. Nothing in here takes a row
-- apart or reaches for a table, so the planner can fold the whole test
-- into the query that calls it.
drop function if exists public.busy_word_matches(text[], text, text);

create or replace function public.busy_word_matches(
  p_words text[], p_comp text, p_word text, p_word_compact text)
returns boolean
language sql
immutable
parallel safe
as $function$
  select case
    -- A word carrying a digit is a number or a code -- a size, a grade, a
    -- voucher number. It matches as written or it does not match.
    when p_word ~ '[0-9]' then p_comp like '%' || p_word_compact || '%'
    -- Letters: present as written is still the first answer.
    when p_comp like '%' || p_word_compact || '%' then true
    else exists (select 1 from unnest(p_words) rw where public.busy_near(rw, p_word))
  end;
$function$;

revoke all on function public.busy_word_matches(text[], text, text, text) from public, anon;
grant execute on function public.busy_word_matches(text[], text, text, text) to authenticated, service_role;

comment on function public.busy_word_matches(text[], text, text, text) is
  'Does one query word match one row? Exact for anything carrying a digit; present as written, or a near spelling of one of the row words, for letters. The compacted form of the word is passed in because working it out per row is the single most expensive thing the search used to do.';

create or replace function public.busy_search(
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

  -- The fourth layer, decided here rather than row by row.
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
    select public.busy_numbers(p_query) as nums,
           (select extreme_rate_multiple from public.busy_sync_settings where id = 1) as mult,
           (select extreme_rate_min_rows from public.busy_sync_settings where id = 1) as minrows
  ),
  scoped as (
    select h.*
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
      (select bool_and(s.search_norm ~ ('(^|[^0-9.])' || replace(n, '.', '\.') || '([^0-9.]|$)'))
         from unnest(q.nums) n) as numbers_ok,
      (v_raw <> '' and s.search_text ilike '%' || v_raw || '%') as hit_exact,
      (v_raw <> '' and
        (select bool_and(s.search_comp like '%' || t.cw || '%')
           from unnest(v_words, v_cwords) as t(w, cw))) as hit_cleaned,
      -- A word that was cut in two is a word nothing matched, so the
      -- third layer cannot succeed once a split has happened. Skipped,
      -- not merely false: it is a whole pass over the rows.
      (case when v_split or v_raw = '' then false
            else (select bool_and(public.busy_word_matches(s.search_words, s.search_comp, t.w, t.cw))
                    from unnest(v_words, v_cwords) as t(w, cw)) end) as hit_fuzzy,
      (case when v_split then
        (select bool_and(public.busy_word_matches(s.search_words, s.search_comp, t.w, t.cw))
           from unnest(v_ewords, v_ecwords) as t(w, cw))
       else false end) as hit_split,
      q.mult as mult, q.minrows as minrows
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
         case when v_raw = ''     then 0
              when j.hit_exact    then 1
              when j.hit_cleaned  then 2
              when j.hit_fuzzy    then 3
              else 4 end as match_tier
  from judged j
  left join public.busy_item_rate_stats st
         on st.company = j.company and st.item = j.item
  where v_raw = ''
     or (coalesce(j.numbers_ok, true)
         and (j.hit_exact or j.hit_cleaned or j.hit_fuzzy or j.hit_split))
  order by match_tier, j.vch_date desc nulls last
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$function$;

revoke all on function public.busy_search(text, text, text, text[], date, date, integer, integer) from public, anon;
grant execute on function public.busy_search(text, text, text, text[], date, date, integer, integer) to authenticated, service_role;

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
      and (p_date_from is null or h.vch_date >= p_date_from)
      and (p_date_to   is null or h.vch_date <= p_date_to)
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

revoke all on function public.busy_search_count(text, text, text, text[], date, date) from public, anon;
grant execute on function public.busy_search_count(text, text, text, text[], date, date) to authenticated, service_role;
