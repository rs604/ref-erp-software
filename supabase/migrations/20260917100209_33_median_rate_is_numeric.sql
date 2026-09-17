-- ============================================================
-- 33 median_rate came back as double precision
--
-- percentile_cont only sorts double precision or interval, so handing it
-- a numeric rate quietly casts to double precision and returns double
-- precision. busy_search declares median_rate as numeric, so every call
-- failed with "structure of query does not match function result type".
--
-- Money is numeric everywhere else in this database and stays numeric
-- here. Cast once, in the view, rather than in every caller.
-- ============================================================

drop view if exists public.busy_item_rate_stats;

create view public.busy_item_rate_stats as
select company,
       item,
       count(*)::int as priced_rows,
       (percentile_cont(0.5) within group (order by rate))::numeric(18,4) as median_rate
from public.busy_history
where rate is not null and rate > 0 and coalesce(qty,0) > 0
group by company, item;

comment on view public.busy_item_rate_stats is
  'The middle rate for each item, per firm, counting only rows that actually carry a rate. This is what an extreme rate is measured against -- 80 times the usual rate for that item is a unit mix-up, while an expensive item is just expensive. Internal to busy_search: it spans both firms by design, so no screen reads it.';

revoke all on public.busy_item_rate_stats from authenticated, anon;
