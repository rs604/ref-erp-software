-- ============================================================
-- 44 THE PARSE SERVICE IS NOT NEEDED
--
-- Raghbir tested access-parser, a pure-Python library, against a real
-- file: COMP0003/db12025.bds, 87 tables, Tran1 3,591 and Tran2 18,858
-- rows, read in 6 seconds, identical to what mdbtools produced.
--
-- So there is no system package to install, no Dockerfile, no container
-- and no Cloud Run deploy. busy/parse-service/ has been removed.
--
-- The one-time load now goes straight from the browser: the parser's
-- output file is read on the screen, split into one batch per firm and
-- year, and handed to busy_import_fy. The database checks who is asking,
-- so no service key is involved at any point.
--
-- parse_service_url is left in place rather than dropped, because
-- dropping a column needs the owner's say-so. Nothing reads it.
-- ============================================================

comment on column public.busy_sync_settings.parse_service_url is
  'NO LONGER USED. It was for a container running mdbtools, which turned out to be unnecessary: access-parser reads a .bds file in pure Python. Nothing reads this column. Left in place only because dropping a column needs the owner''s approval.';
