-- ============================================================
-- 43 A PLACE TO KEEP THE UPLOADER
--
-- The download screen needs somewhere to hold RefBusyUploader.exe. None
-- of the existing buckets will do:
--   documents  accepts only PDF, JPG and PNG -- an .exe is refused, and
--              that rule must stay exactly as it is
--   backups    is the nightly export and nothing else belongs in it
--
-- So a bucket of its own, private, owner only, for programs this ERP
-- hands out. It is deliberately NOT the documents bucket, so the rule
-- that no uploaded document can be an executable is untouched.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-downloads', 'app-downloads', false, 104857600,
        array['application/octet-stream','application/x-msdownload','application/vnd.microsoft.portable-executable','application/zip'])
on conflict (id) do nothing;

-- Owner only, both ways. Nobody else needs it and nobody else should have it.
drop policy if exists app_downloads_read on storage.objects;
create policy app_downloads_read on storage.objects for select to authenticated
  using (bucket_id = 'app-downloads' and public.is_owner());

drop policy if exists app_downloads_write on storage.objects;
create policy app_downloads_write on storage.objects for insert to authenticated
  with check (bucket_id = 'app-downloads' and public.is_owner());

drop policy if exists app_downloads_update on storage.objects;
create policy app_downloads_update on storage.objects for update to authenticated
  using (bucket_id = 'app-downloads' and public.is_owner())
  with check (bucket_id = 'app-downloads' and public.is_owner());

alter table public.busy_sync_settings
  add column uploader_bucket text not null default 'app-downloads';

comment on column public.busy_sync_settings.uploader_bucket is
  'Which bucket holds the uploader program. Its own bucket on purpose: the documents bucket refuses anything that is not a PDF, JPG or PNG, and that rule stays.';
