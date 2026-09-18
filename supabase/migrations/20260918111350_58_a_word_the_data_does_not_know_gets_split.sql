-- ============================================================
-- 58 A WORD THE DATA DOES NOT KNOW GETS SPLIT -- AND THE SEARCH
--    STOPS DOING THE SAME WORK 21,470 TIMES
--
-- Migration 57 got the answers right and the speed wrong. Measured on
-- Raghbir's own data, "agarwal" took 12.0 seconds against a limit of 8,
-- so the screen would have timed out on a search that works. Two things
-- were wrong with it, and both are fixed here.
--
-- FIRST: THE ROWS WERE BEING TAKEN APART ON EVERY SEARCH
-- Every search normalised and compacted all 21,470 item rows from
-- scratch -- 538 milliseconds of the same answer, recomputed each time.
-- That work now belongs to the row. search_norm, search_comp and
-- search_words are stored alongside search_text and kept by the database
-- itself, so no import and no caller can forget to fill them.
--
-- SECOND: THE SPLIT WAS BEING DECIDED ROW BY ROW
-- 57 asked, of every row, "could this word be cut in two so that both
-- halves match here?" -- four cuts, eight halves, 21,470 times. But
-- whether "junejpipe" is two words is a question about the WORD, not
-- about any one row. It is asked once now, against the vocabulary of the
-- company's own history: 3,721 words for REF. If the word is one the
-- data already knows, nothing is split. If it is not, every cut leaving
-- at least three letters on each side is tried, and a cut is accepted
-- only when the data knows BOTH halves. JUNEJPIPE -> JUNEJ + PIPE, one
-- cut accepted out of four. The search then runs once, on the rewritten
-- words. So the fourth layer costs one more pass over the rows instead
-- of eight, and only when a word was actually rewritten.
--
-- WHAT DID NOT CHANGE
-- The rules 57 set out stand, and are restated here so the file can be
-- read on its own:
--   * Fuzzy is edit distance, not trigram overlap. similarity('JUNEJA',
--     'JUNJA') = 0.444, below any gate that would still be useful, while
--     'SHEET'/'SHEEL' scores 0.500 -- higher than the typo we want.
--     Trigrams cannot tell those apart; edit distance can. The allowance
--     is 1 letter up to six, 2 beyond, and nothing under four letters is
--     guessed at.
--   * Fuzzy applies to WORDS, never to numbers. Any query word carrying
--     a digit matches character for character, is never fuzzed, is never
--     split, and is never offered as half of a split. 80X40X2.5 and
--     80X40X3 are different pipes. The whole-number test still gates
--     every layer.
--   * match_tier says which layer answered -- 0 nothing typed, 1 exact,
--     2 cleaned, 3 fuzzy, 4 words run together -- so a guess can be
--     shown as a guess. A fuzzy match must never be presented as an
--     exact one.
-- ============================================================

-- ---------- the rows carry their own searchable forms ----------
-- Generated, not filled by the importer: a column the importer has to
-- remember is a column that will one day be wrong.
alter table public.busy_history
  add column if not exists search_norm  text
    generated always as (public.busy_normalise(search_text)) stored,
  add column if not exists search_comp  text
    generated always as (public.busy_compact(search_text)) stored,
  add column if not exists search_words text[]
    generated always as (string_to_array(public.busy_normalise(search_text), ' ')) stored;

comment on column public.busy_history.search_norm  is 'search_text in capitals with punctuation turned into single spaces. Kept by the database so no search has to work it out again.';
comment on column public.busy_history.search_comp  is 'search_text with everything run together, for matching across spacing and punctuation.';
comment on column public.busy_history.search_words is 'The words of search_norm, so a search can compare word against word without taking the row apart first.';

-- ---------- the tests themselves ----------
-- 57 shipped these with a different shape. Dropped rather than left
-- beside the new ones: two ways to ask the same question is how call
-- sites drift.
drop function if exists public.busy_word_matches(text, text, text);
drop function if exists public.busy_word_matches_split(text, text, text);

-- Are these two words near enough to be the same word badly typed?
-- Letters only, and never across a length gap wider than the allowance.
create or replace function public.busy_near(p_a text, p_b text)
returns boolean
language sql
immutable
parallel safe
as $function$
  select p_a is not null and p_b is not null
     and p_a !~ '[0-9]' and p_b !~ '[0-9]'   -- a number is never nearly another number
     and length(p_b) >= 4                    -- under four letters there is no room to guess
     and abs(length(p_a) - length(p_b))
           <= (case when greatest(length(p_a), length(p_b)) <= 6 then 1 else 2 end)
     and extensions.levenshtein_less_equal(p_a, p_b,
           (case when greatest(length(p_a), length(p_b)) <= 6 then 1 else 2 end))
           <= (case when greatest(length(p_a), length(p_b)) <= 6 then 1 else 2 end);
$function$;

-- Does one query word match one row? The row hands over its own stored
-- words and compacted text, so nothing is taken apart here.
create or replace function public.busy_word_matches(p_words text[], p_comp text, p_word text)
returns boolean
language sql
immutable
parallel safe
as $function$
  select case
    -- A word carrying a digit is a number or a code -- a size, a grade, a
    -- voucher number. It matches as written or it does not match.
    when p_word ~ '[0-9]' then p_comp like '%' || public.busy_compact(p_word) || '%'
    -- Letters: present as written is still the first answer.
    when p_comp like '%' || public.busy_compact(p_word) || '%' then true
    else exists (select 1 from unnest(p_words) rw where public.busy_near(rw, p_word))
  end;
$function$;

-- Two words typed run together. Asked once per search, of the word, not
-- of every row. Returns the words to search for: unchanged where the
-- data knows them, cut in two where it does not and both halves are
-- known. The most even cut wins, so JUNEJPIPE gives JUNEJ + PIPE rather
-- than JUN + EJPIPE.
create or replace function public.busy_split_query(p_company text, p_words text[])
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with vocab as (
    select distinct wd
      from public.busy_history h, unnest(h.search_words) wd
     where h.company = p_company and h.kind = 'item' and h.deleted_at is null
       and wd <> '' and wd !~ '[0-9]'
  ),
  w as (
    select t.ordinality as k, t.word
      from unnest(p_words) with ordinality as t(word, ordinality)
     where t.word <> ''
  ),
  candidate as (        -- only a long word of letters can be two words
    select w.k, w.word from w
     where w.word !~ '[0-9]' and length(w.word) >= 6
       and not exists (select 1 from vocab v
                        where v.wd like '%' || w.word || '%'
                           or public.busy_near(v.wd, w.word))
  ),
  cuts as (
    select c.k, i,
           left(c.word, i) as a,
           right(c.word, length(c.word) - i) as b
      from candidate c, generate_series(3, length(c.word) - 3) i
  ),
  good as (
    select distinct on (c.k) c.k, c.i, c.a, c.b
      from cuts c
     where exists (select 1 from vocab v where v.wd like '%' || c.a || '%' or public.busy_near(v.wd, c.a))
       and exists (select 1 from vocab v where v.wd like '%' || c.b || '%' or public.busy_near(v.wd, c.b))
     order by c.k, least(length(c.a), length(c.b)) desc, c.i
  )
  select coalesce(array_agg(x.word order by x.k, x.part), '{}')
    from (
      select w.k, 0 as part, w.word from w
       where not exists (select 1 from good g where g.k = w.k)
      union all
      select g.k, 1, g.a from good g
      union all
      select g.k, 2, g.b from good g
    ) x;
$function$;

revoke all on function public.busy_near(text, text) from public, anon;
revoke all on function public.busy_word_matches(text[], text, text) from public, anon;
revoke all on function public.busy_split_query(text, text[]) from public, anon;
grant execute on function public.busy_near(text, text) to authenticated, service_role;
grant execute on function public.busy_word_matches(text[], text, text) to authenticated, service_role;
grant execute on function public.busy_split_query(text, text[]) to authenticated, service_role;

comment on function public.busy_near(text, text) is
  'Two words near enough to be the same word badly typed: edit distance 1 up to six letters, 2 beyond. Never true of anything carrying a digit.';
comment on function public.busy_word_matches(text[], text, text) is
  'Does one query word match one row? Exact for anything carrying a digit; present as written, or a near spelling of one of the row words, for letters.';
comment on function public.busy_split_query(text, text[]) is
  'Rewrites the typed words, cutting a word the data does not know into two it does. Asked once per search, never per row.';

-- ---------- the search ----------
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
  v_raw    text;
  v_words  text[];
  v_ewords text[];
  v_split  boolean := false;
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

  -- The fourth layer, decided here rather than row by row.
  if v_raw <> '' and exists (select 1 from unnest(v_words) w
                              where w !~ '[0-9]' and length(w) >= 6) then
    v_ewords := public.busy_split_query(p_company, v_words);
    v_split  := v_ewords is distinct from v_words;
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
        (select bool_and(s.search_comp like '%' || public.busy_compact(w) || '%')
           from unnest(v_words) w)) as hit_cleaned,
      (v_raw <> '' and
        (select bool_and(public.busy_word_matches(s.search_words, s.search_comp, w))
           from unnest(v_words) w)) as hit_fuzzy,
      -- case, not and, so the rewritten words are only tried when a word
      -- was actually rewritten.
      (case when v_split then
        (select bool_and(public.busy_word_matches(s.search_words, s.search_comp, w))
           from unnest(v_ewords) w)
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

comment on function public.busy_search(text, text, text, text[], date, date, integer, integer) is
  'Price history search, layered: 1 exact, 2 cleaned, 3 fuzzy on letters, 4 words typed run together. Numbers and codes always match exactly. match_tier says which layer answered, so a guess can be shown as a guess.';

-- The count must apply the same four layers through the same functions,
-- or the pager counts rows the table does not show.
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
  v_n      bigint;
  v_raw    text;
  v_words  text[];
  v_ewords text[];
  v_split  boolean := false;
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

  if v_raw <> '' and exists (select 1 from unnest(v_words) w
                              where w !~ '[0-9]' and length(w) >= 6) then
    v_ewords := public.busy_split_query(p_company, v_words);
    v_split  := v_ewords is distinct from v_words;
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
        (select bool_and(s.search_comp like '%' || public.busy_compact(w) || '%')
           from unnest(v_words) w)) as hit_cleaned,
      (v_raw <> '' and
        (select bool_and(public.busy_word_matches(s.search_words, s.search_comp, w))
           from unnest(v_words) w)) as hit_fuzzy,
      (case when v_split then
        (select bool_and(public.busy_word_matches(s.search_words, s.search_comp, w))
           from unnest(v_ewords) w)
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

comment on function public.busy_search_count(text, text, text, text[], date, date) is
  'How many rows busy_search would return for the same filters. Applies the same four layers through the same functions, so the count and the rows cannot drift apart.';
