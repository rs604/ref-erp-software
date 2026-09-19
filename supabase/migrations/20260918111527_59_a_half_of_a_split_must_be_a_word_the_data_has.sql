-- ============================================================
-- 59 A HALF OF A SPLIT MUST BE A WORD THE DATA ACTUALLY HAS
--
-- 58 cut "JUNEJPIPE" into JUNE + JPIPE instead of JUNEJ + PIPE. Two
-- faults, both in how a cut was chosen.
--
-- The first: a half was accepted on a near spelling. JPIPE is not in the
-- data at all, but it is one letter from PIPE, so the fuzzy test let it
-- through. That is a guess on top of a guess -- we had already guessed
-- that the word was two words. A half must now be present in the data AS
-- WRITTEN: either a word in its own right, or inside a longer one. The
-- word being cut is still allowed to be a near spelling; only the halves
-- must be real. JPIPE fails that, so the JUNE cut disappears.
--
-- The second: with several cuts surviving, the tie went to the earliest
-- one rather than the best one. A cut is now scored -- 2 for a half that
-- is a whole word in the data, 1 for a half that only appears inside
-- one -- and the highest score wins, then the most even cut, then the
-- earliest. JUNEJ + PIPE scores 1 + 2 = 3 and is the only cut left
-- standing anyway, but the ordering now says why.
-- ============================================================

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
       -- A word the data knows -- as written, inside a longer word, or as
       -- a near spelling -- is not a word run together. Nothing to cut.
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
  scored as (
    -- 2: a word of its own. 1: only inside a longer word. 0: not there,
    -- and a cut with a 0 in it is no cut at all.
    select c.k, c.i, c.a, c.b,
           (select max(case when v.wd = c.a then 2 else 1 end)
              from vocab v where v.wd like '%' || c.a || '%') as sa,
           (select max(case when v.wd = c.b then 2 else 1 end)
              from vocab v where v.wd like '%' || c.b || '%') as sb
      from cuts c
  ),
  good as (
    select distinct on (s.k) s.k, s.i, s.a, s.b
      from scored s
     where s.sa is not null and s.sb is not null
     order by s.k, (s.sa + s.sb) desc, least(length(s.a), length(s.b)) desc, s.i
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

comment on function public.busy_split_query(text, text[]) is
  'Rewrites the typed words, cutting a word the data does not know into two halves it does have, as written. Asked once per search, never per row.';
