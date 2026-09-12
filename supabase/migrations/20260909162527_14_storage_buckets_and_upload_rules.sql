-- ============================================================
-- 14 STORAGE
-- Three buckets, all private. A file lands in quarantine, is scanned,
-- and only then moves to the bucket people can read from.
-- The bucket itself refuses anything that is not PDF, JPG or PNG,
-- so an executable cannot be stored even if a screen is tricked.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('quarantine', 'quarantine', false, 26214400,
     array['application/pdf','image/jpeg','image/png']),
  ('documents',  'documents',  false, 26214400,
     array['application/pdf','image/jpeg','image/png']),
  ('km-photos',  'km-photos',  false, 26214400,
     array['image/jpeg','image/png'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage policies are created for anon or authenticated on purpose.
-- Nothing reads or writes these buckets directly from a browser. Uploads go
-- through the upload function, downloads come back as short-lived signed
-- links from the download function, and both check permissions first.

-- ---------- Close the hole the linter pointed at ----------
-- replace_attachment ran with owner powers and took any attachment id, so a
-- signed-in user could have swapped somebody else's document. It now checks
-- the same permissions the screens do.
create or replace function public.replace_attachment(
  p_old_id          uuid,
  p_file_name       text,
  p_mime_type       text,
  p_size_bytes      bigint,
  p_storage_bucket  text,
  p_storage_path    text,
  p_checksum        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.attachments%rowtype;
  v_new_id uuid;
begin
  if public.current_party_id() is null then
    raise exception 'Not signed in';
  end if;

  select * into o from public.attachments where id = p_old_id;
  if not found then
    raise exception 'Attachment % not found', p_old_id;
  end if;

  if not (
        public.has_permission('employee_master.edit')
     or public.has_permission('vendor_master.edit')
     or (o.party_id is not null and o.party_id = public.current_party_id())
  ) then
    raise exception 'You do not have permission to replace this file';
  end if;

  if p_mime_type not in ('application/pdf','image/jpeg','image/png') then
    raise exception 'Only PDF, JPG and PNG files are accepted';
  end if;

  update public.attachments
     set is_current  = false,
         replaced_at = now(),
         replaced_by = public.current_party_id()
   where id = p_old_id;

  insert into public.attachments (
    entity_table, entity_id, party_id, doc_category, title,
    file_name, mime_type, size_bytes, storage_bucket, storage_path, checksum_sha256,
    version, replaces_id, is_current, status, created_by, scan_status
  ) values (
    o.entity_table, o.entity_id, o.party_id, o.doc_category, o.title,
    p_file_name, p_mime_type, p_size_bytes, p_storage_bucket, p_storage_path, p_checksum,
    o.version + 1, o.id, true, 'draft', public.current_party_id(), 'pending'
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.replace_attachment(uuid, text, text, bigint, text, text, text)
  from public, anon;
grant execute on function public.replace_attachment(uuid, text, text, bigint, text, text, text)
  to authenticated;
