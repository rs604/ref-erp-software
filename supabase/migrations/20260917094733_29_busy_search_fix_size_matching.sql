-- ============================================================
-- 29 THE SEARCH FOUND NOTHING. FIXED.
--
-- The first version of busy_search required every number typed to appear
-- as its own word, surrounded by spaces. But a pipe size is written
-- GLUED TOGETHER -- 80X40X2.5 -- so "80" is never its own word and the
-- guard threw away every single row. Every search returned nothing.
--
-- Found by running the real rows through it instead of assuming it worked.
--
-- Two changes:
--   1. A number now counts as present when it is bounded by anything that
--      is not a digit or a dot. So 80 matches inside 80X40X2.5, but 5 does
--      NOT match inside 2.5, and 3 still does not match 80X40X2.5 at all.
--   2. busy_compact() strips the spaces out of both sides, so
--      "80 x 40 x 2.5" finds a row written 80X40X2.5. The dot is KEPT --
--      dropping it would turn 2.5 into 25 and collide with "25 LENGTH".
-- ============================================================

create or replace function public.busy_compact(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(upper(coalesce(p_text,'')), '[^A-Z0-9.]+', '', 'g');
$$;
comment on function public.busy_compact(text) is
  'Upper-case with every separator removed, but the decimal point kept. "80 x 40 x 2.5" and "80X40X2.5" both become 80X40X2.5. Removing the dot as well would turn 2.5 into 25 and match the wrong pipe.';

create or replace function public.busy_search(
  p_company    text,
  p_query      text default null,
  p_party      text default null,
  p_doc_type   text default null,
  p_date_from  date default null,
  p_date_to    date default null,
  p_limit      int  default 200,
  p_offset     int  default 0
)
returns table (
  id uuid, company text, fy text, doc_type text, vch_no text, vch_date date,
  party text, item text, description text, qty numeric, rate numeric,
  amount numeric, is_lump_sum boolean, is_extreme_rate boolean, match_tier int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select btrim(coalesce(p_query,''))        as raw,
           public.busy_normalise(p_query)     as nq,
           public.busy_numbers(p_query)       as nums,
           (select extreme_rate_threshold from public.busy_sync_settings where id = 1) as thr
  ),
  scoped as (
    select h.*, public.busy_normalise(h.search_text) as norm,
                public.busy_compact(h.search_text)   as comp
    from public.busy_history h
    where h.company = p_company
      and (p_party     is null or h.party = p_party)
      and (p_doc_type  is null or h.doc_type = p_doc_type)
      and (p_date_from is null or h.vch_date >= p_date_from)
      and (p_date_to   is null or h.vch_date <= p_date_to)
  ),
  judged as (
    select s.*,
      -- EVERY number typed must be present, exactly. A number counts as
      -- present when what sits either side of it is not a digit or a dot.
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
      q.raw as raw, q.thr as thr
    from scoped s, q
  )
  select j.id, j.company, j.fy, j.doc_type, j.vch_no, j.vch_date,
         j.party, j.item, j.description, j.qty, j.rate, j.amount,
         j.is_lump_sum,
         (j.rate is not null and j.rate > j.thr) as is_extreme_rate,
         case when j.raw = '' then 3
              when j.hit_exact then 1
              when j.hit_cleaned then 2
              else 3 end as match_tier
  from judged j
  where j.raw = ''
     or (coalesce(j.numbers_ok, true)
         and (j.hit_exact or j.hit_cleaned or j.hit_fuzzy))
  order by match_tier, j.vch_date desc nulls last
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
comment on function public.busy_search(text,text,text,text,date,date,int,int) is
  'Layered search: exact first, then the same words ignoring spacing and punctuation in any order, then fuzzy for typos. Fuzzy is only ever reached when NO number was typed. If a size was typed it must match exactly, because 80X40X2.5 and 80X40X3 are different pipes and calling them 95% similar would show the wrong price.';
