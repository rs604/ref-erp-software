-- ============================================================
-- 46. Drop extreme_rate_threshold.
--
-- It was the Phase 2 rule: flag any rate above a flat 50,000 rupees. That
-- catches expensive items, which are not a fault, and misses a rate that is
-- eighty times what the same item usually costs, which is. Migration 30
-- replaced it with extreme_rate_multiple -- a multiple of the median rate for
-- the SAME item in the SAME firm -- and nothing has read the old column since.
--
-- Checked before dropping: no function, no view, no constraint and no screen
-- refers to it. Raghbir approved the drop; a column is never dropped without
-- that.
-- ============================================================

alter table public.busy_sync_settings
  drop column extreme_rate_threshold;

comment on column public.busy_sync_settings.extreme_rate_multiple is
  'A rate is flagged when it is more than this many times the median rate for the same item in the same firm. Catches tonnes billed as kilograms without flagging things that are simply expensive. This replaced a flat rupee figure, which flagged expensive items and missed unit mix-ups.';
