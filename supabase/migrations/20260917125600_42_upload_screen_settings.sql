-- ============================================================
-- 42 WHAT THE UPLOAD SCREEN NEEDS
--
-- Where the parse service lives, where the uploader .exe is kept, and
-- the row counts the one-time load is expected to produce. All settings,
-- so none of them is a code change later.
-- ============================================================

alter table public.busy_sync_settings
  add column parse_service_url      text,
  add column uploader_storage_path  text,
  add column expected_item_rows_ref int not null default 21307,
  add column expected_item_rows_rs  int not null default 1425,
  add column expected_total_rows    int not null default 47635;

comment on column public.busy_sync_settings.parse_service_url is
  'Where the parse service runs. It has to be a container with mdbtools installed -- a Supabase edge function cannot read a Busy file. See busy/parse-service/README.md.';
comment on column public.busy_sync_settings.uploader_storage_path is
  'Where the built uploader .exe sits in the uploads bucket, so the download screen can hand it over. The .exe is built on a Windows machine from busy/uploader/.';
comment on column public.busy_sync_settings.expected_item_rows_ref is
  'What the one-time load should produce for REF, proven by the parser across 24 files. The screen counts up against it so a short load is obvious while it is happening, not afterwards.';
comment on column public.busy_sync_settings.expected_total_rows is
  'All rows, both firms, item and ledger together: 47,635 across the 24 files.';
