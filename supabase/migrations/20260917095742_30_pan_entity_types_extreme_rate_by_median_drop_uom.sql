-- ============================================================
-- 30 THREE CORRECTIONS RAGHBIR MADE AGAINST THE FULL DATASET
--
--  (1) PAN: the fourth letter says what KIND of entity it is. Allowing
--      only C and P would have blocked every partnership firm, and we
--      buy from them.
--  (2) Extreme rates: a flat rupee figure is the wrong test. A gear box
--      at Rs 47,621 and a hoist at Rs 83,000 are both normal prices.
--      Compare each rate against other rates for the SAME item instead.
--  (3) items.uom is dropped. Checked first, as asked: no screen, no
--      view, no function, no constraint and no index reads it, and the
--      table is empty. unit_id replaced it in migration 21.
-- ============================================================

-- ---------- (1) PAN: five entity types, not two ----------
alter table public.parties drop constraint if exists parties_pan_matches_party_type;

alter table public.parties add constraint parties_pan_matches_party_type
  check (
    pan is null
    -- P is an individual.
    or (party_type = 'person'  and substring(pan from 4 for 1) = 'P')
    -- Everything else we deal with is an entity: C company, F partnership
    -- firm, H Hindu Undivided Family, T trust.
    or (party_type = 'company' and substring(pan from 4 for 1) in ('C','F','H','T'))
  );

comment on column public.parties.pan is
  'The fourth letter says what kind of entity this is: P individual, C company, F partnership firm, H HUF, T trust. A person must be P and an entity must be one of the other four, which still catches a personal PAN typed onto a company record without blocking the partnership firms we buy from.';

-- ---------- (2) Extreme rate: 10x the median for the SAME item ----------
alter table public.busy_sync_settings
  add column extreme_rate_multiple numeric(8,2) not null default 10
    check (extreme_rate_multiple > 1),
  add column extreme_rate_min_rows int not null default 3
    check (extreme_rate_min_rows > 0);

comment on column public.busy_sync_settings.extreme_rate_multiple is
  'A rate is flagged when it is more than this many times the median rate for the same item in the same firm. Catches tonnes billed as kilograms without flagging things that are simply expensive.';
comment on column public.busy_sync_settings.extreme_rate_min_rows is
  'How many priced rows an item needs before a median means anything. Below this nothing is flagged, because a median taken from one row would flag the second one.';
comment on column public.busy_sync_settings.extreme_rate_threshold is
  'DEPRECATED by extreme_rate_multiple. A flat rupee figure flagged genuinely expensive items. Left in place only because dropping a column needs the owner''s approval. Nothing reads it.';

-- Lump-sum rows have no rate, so they must not drag a median to zero and
-- make every real price look a hundred times too big.
create view public.busy_item_rate_stats
with (security_invoker = true) as
select company,
       item,
       count(*)::int as priced_rows,
       percentile_cont(0.5) within group (order by rate) as median_rate
from public.busy_history
where rate is not null and rate > 0 and coalesce(qty,0) > 0
group by company, item;

comment on view public.busy_item_rate_stats is
  'The middle rate for each item, per firm, counting only rows that actually carry a rate. This is what an extreme rate is measured against -- 80 times the usual rate for that item is a unit mix-up, while an expensive item is just expensive.';

-- The signature gains median_rate, so the old one has to go first.
drop function if exists public.busy_search(text,text,text,text,date,date,int,int);

create function public.busy_search(
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
  amount numeric, is_lump_sum boolean, is_extreme_rate boolean,
  median_rate numeric, match_tier int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
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
      and (p_party     is null or h.party = p_party)
      and (p_doc_type  is null or h.doc_type = p_doc_type)
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
         -- Flagged, never hidden: more than N times the usual rate for
         -- this same item, and only once the item has enough priced rows
         -- for a middle value to mean anything.
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
$$;
comment on function public.busy_search(text,text,text,text,date,date,int,int) is
  'Layered search: exact first, then the same words ignoring spacing and punctuation in any order, then fuzzy for typos. Fuzzy is only ever reached when NO number was typed -- a size must match exactly, because 80X40X2.5 and 80X40X3 are different pipes. Also returns the middle rate for the item and whether this row is far above it.';

-- ---------- (3) uom goes ----------
-- Checked before dropping, as asked: nothing reads it anywhere.
alter table public.items drop column uom;
