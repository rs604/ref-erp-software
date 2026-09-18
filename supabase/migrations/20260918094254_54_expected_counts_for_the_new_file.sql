-- ============================================================
-- 54 THE EXPECTED COUNTS FOR THE NEW FILE
--
-- The load screen compares what landed against what is expected and says
-- SHORT in red when they differ. Left at the old numbers it would have
-- reported a shortfall that was not one, or worse, reported a match while
-- 51,000 new rows were missing.
--
-- Raghbir's counts for the new parser, which reads six more voucher types
-- and the opening balances out of Folio1:
--
--     total    98,644   (was 47,635)
--     item     22,902   REF 21,470 · RS 1,432
--     ledger   74,295   REF 67,763 · RS 6,532
--     opening   1,447   REF  1,065 · RS   382
-- ============================================================

update public.busy_sync_settings set
  expected_total_rows    = 98644,
  expected_item_rows_ref = 21470,
  expected_item_rows_rs  = 1432
where id = 1;

comment on column public.busy_sync_settings.expected_total_rows is
  'What a complete load should come to, counted from the Busy files themselves. The load screen says SHORT in red against this, so a year that failed cannot be mistaken for a year that is still coming.';
