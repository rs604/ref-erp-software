-- ============================================================
-- 57 FUZZY ON LETTERS, EXACT ON DIGITS -- AND A WORD MAY BE SPLIT
--
-- Raghbir typed "junja" and did not get JUNEJA. He typed "junejpipe"
-- and got nothing. Both are the third layer of the search failing, and
-- they fail for two different reasons.
--
-- WHY "junja" FAILED
-- The old fuzzy test was extensions.similarity(row_word, query_word) > 0.5.
-- Measured on his own data, similarity('JUNEJA','JUNJA') = 0.444. One
-- dropped letter in a six-letter name scores below the gate, so the layer
-- never fired. Raising the gate is not the answer either: 'SHEET' against
-- 'SHEEL' scores 0.500, HIGHER than the typo we want to catch. Trigram
-- overlap cannot separate them, so it is the wrong instrument for this.
-- Edit distance is the right one: JUNEJA/JUNJA is 1 letter, AGGARWAL/
-- AGARWAL is 1 letter, and the allowance is set by word length --
-- 1 letter up to six, 2 letters beyond. Short words (under four letters)
-- get no allowance at all, because at that length everything is near
-- everything.
--
-- WHY "junejpipe" FAILED, AND WHY FUZZY ALONE CANNOT FIX IT
-- Two words run together is not a spelling mistake. Measured:
-- similarity('JUNEJA','JUNEJPIPE') = 0.417 and similarity('PIPE',
-- 'JUNEJPIPE') = 0.250; edit distance 4 and 5. No threshold that lets
-- those through would keep the search usable. So a run-together word
-- gets its own handling, as a FOURTH layer below fuzzy: if a word matches
-- nothing, try cutting it in two, and accept only if BOTH halves match.
-- JUNEJ + PIPE, both present, both real. Nothing shorter than three
-- letters is offered as a half.
--
-- THE RULE THAT DOES NOT BEND
-- Fuzzy applies to WORDS, never to numbers. 80X40X2.5 and 80X40X3 are
-- different pipes. So any query word carrying a digit is matched
-- character for character and is never fuzzed, is never split, and is
-- never used as a half of a split. The existing whole-number test --
-- every number in the query must appear as a standalone number in the
-- row -- still gates every layer, including the exact one.
--
-- SAYING WHICH KIND OF MATCH IT IS
-- match_tier used to be 1 exact, 2 cleaned, 3 everything else, which put
-- "no search typed" and "close guess" in the same bucket. It is now:
--   0  nothing typed
--   1  exact -- the words appear as typed
--   2  cleaned -- same words, different spacing or punctuation
--   3  fuzzy -- a spelling close to what was typed
--   4  split -- words that were run together
-- so the screen can label a guess as a guess. A fuzzy match must never
-- be presented as an exact one.
--
-- The two search functions share these tests through named functions
-- rather than each carrying a copy, because two copies of a rule is how
-- a count stops agreeing with the rows it counted.
-- ============================================================

-- Does one query word match this row? The row arrives already normalised
-- (words separated by single spaces) and compacted (everything run
-- together), because the caller computes those once per row.
create or replace function public.busy_word_matches(p_norm text, p_comp text, p_word text)
returns boolean
language sql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
  select case
    -- A word carrying a digit is a number or a code -- a size, a grade, a
    -- voucher number. It matches as written or it does not match.
    when p_word ~ '[0-9]' then p_comp like '%' || public.busy_compact(p_word) || '%'
    -- Letters: present as written is still the first answer.
    when p_comp like '%' || public.busy_compact(p_word) || '%' then true
    -- Under four letters there is no room to guess.
    when length(p_word) < 4 then false
    else exists (
      select 1
        from unnest(string_to_array(p_norm, ' ')) rw
        cross join lateral (
          select case when greatest(length(rw), length(p_word)) <= 6 then 1 else 2 end as d
        ) a
       where rw <> ''
         and rw !~ '[0-9]'                       -- never fuzz against a number
         and abs(length(rw) - length(p_word)) <= a.d
         and extensions.levenshtein_less_equal(rw, p_word, a.d) <= a.d)
  end;
$function$;

-- Two words run together. Cut the word at every position that leaves at
-- least three letters on each side, and accept only if both halves match.
create or replace function public.busy_word_matches_split(p_norm text, p_comp text, p_word text)
returns boolean
language sql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
  select p_word !~ '[0-9]'
     and length(p_word) >= 6
     and exists (
       select 1
         from generate_series(3, length(p_word) - 3) i
        where public.busy_word_matches(p_norm, p_comp, left(p_word, i))
          and public.busy_word_matches(p_norm, p_comp, right(p_word, length(p_word) - i)));
$function$;

revoke all on function public.busy_word_matches(text, text, text) from public, anon;
revoke all on function public.busy_word_matches_split(text, text, text) from public, anon;
grant execute on function public.busy_word_matches(text, text, text) to authenticated, service_role;
grant execute on function public.busy_word_matches_split(text, text, text) to authenticated, service_role;

comment on function public.busy_word_matches(text, text, text) is
  'Does one query word match one row? Exact for anything carrying a digit; edit distance for letters, 1 up to six letters and 2 beyond.';
comment on function public.busy_word_matches_split(text, text, text) is
  'Two words typed run together: cut in two and require both halves to match. Never applied to a word carrying a digit.';

-- The shape of both functions is unchanged, so no call site moves.
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
           -- Splitting is only worth attempting if some word is long
           -- enough to be two words, and carries no digit.
           exists (select 1 from unnest(string_to_array(public.busy_normalise(p_query), ' ')) w
                    where w !~ '[0-9]' and length(w) >= 6) as can_split,
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
      (q.raw <> '' and
        (select bool_and(public.busy_word_matches(s.norm, s.comp, w))
           from unnest(string_to_array(q.nq, ' ')) w
          where w <> '')) as hit_fuzzy,
      q.raw as raw, q.nq as nq, q.can_split as can_split,
      q.mult as mult, q.minrows as minrows
    from scoped s, q
  ),
  weighed as (
    -- case, not or, so the splitting is not paid for on rows that have
    -- already matched a layer above it.
    select j.*,
      case when j.raw = '' or j.hit_exact or j.hit_cleaned or j.hit_fuzzy then false
           when not j.can_split then false
           else (select bool_and(public.busy_word_matches(j.norm, j.comp, w)
                              or public.busy_word_matches_split(j.norm, j.comp, w))
                   from unnest(string_to_array(j.nq, ' ')) w
                  where w <> '') end as hit_split
    from judged j
  )
  select j.id, j.company, j.fy, j.doc_type, j.vch_no, j.vch_date,
         j.party, j.item, j.description, j.qty, j.rate, j.amount,
         j.is_lump_sum,
         (j.rate is not null and j.rate > 0
          and st.median_rate is not null
          and st.priced_rows >= j.minrows
          and j.rate > st.median_rate * j.mult) as is_extreme_rate,
         st.median_rate,
         case when j.raw = ''    then 0
              when j.hit_exact   then 1
              when j.hit_cleaned then 2
              when j.hit_fuzzy   then 3
              else 4 end as match_tier
  from weighed j
  left join public.busy_item_rate_stats st
         on st.company = j.company and st.item = j.item
  where j.raw = ''
     or (coalesce(j.numbers_ok, true)
         and (j.hit_exact or j.hit_cleaned or j.hit_fuzzy or j.hit_split))
  order by match_tier, j.vch_date desc nulls last
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$function$;

revoke all on function public.busy_search(text, text, text, text[], date, date, integer, integer) from public, anon;
grant execute on function public.busy_search(text, text, text, text[], date, date, integer, integer) to authenticated, service_role;

comment on function public.busy_search(text, text, text, text[], date, date, integer, integer) is
  'Price history search, layered: 1 exact, 2 cleaned, 3 fuzzy on letters, 4 words run together. Numbers and codes always match exactly. match_tier says which layer answered, so a guess can be shown as a guess.';

-- The count must apply the same four layers, or the pager counts rows the
-- table does not show.
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
           public.busy_numbers(p_query)   as nums,
           exists (select 1 from unnest(string_to_array(public.busy_normalise(p_query), ' ')) w
                    where w !~ '[0-9]' and length(w) >= 6) as can_split
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
      (q.raw <> '' and
        (select bool_and(public.busy_word_matches(s.norm, s.comp, w))
           from unnest(string_to_array(q.nq, ' ')) w
          where w <> '')) as hit_fuzzy,
      s.norm as norm, s.comp as comp,
      q.raw as raw, q.nq as nq, q.can_split as can_split
    from scoped s, q
  ),
  weighed as (
    select j.*,
      case when j.raw = '' or j.hit_exact or j.hit_cleaned or j.hit_fuzzy then false
           when not j.can_split then false
           else (select bool_and(public.busy_word_matches(j.norm, j.comp, w)
                              or public.busy_word_matches_split(j.norm, j.comp, w))
                   from unnest(string_to_array(j.nq, ' ')) w
                  where w <> '') end as hit_split
    from judged j
  )
  select count(*) into v_n
  from weighed j
  where j.raw = ''
     or (coalesce(j.numbers_ok, true)
         and (j.hit_exact or j.hit_cleaned or j.hit_fuzzy or j.hit_split));

  return v_n;
end;
$function$;

revoke all on function public.busy_search_count(text, text, text, text[], date, date) from public, anon;
grant execute on function public.busy_search_count(text, text, text, text[], date, date) to authenticated, service_role;

comment on function public.busy_search_count(text, text, text, text[], date, date) is
  'How many rows busy_search would return for the same filters. Applies the same four layers, through the same two functions, so the count and the rows cannot drift apart.';
