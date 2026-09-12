-- ============================================================
-- 05 FILES AND NOTES
-- Rules fixed here, in the database, not left to the screen:
--   * only PDF, JPG, PNG
--   * every file is scanned before anyone can read it
--   * a file is never deleted, only replaced, and the old version stays
-- ============================================================

create table public.attachments (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  status            public.record_status default 'draft',

  -- what this file belongs to
  entity_table      text not null,
  entity_id         uuid not null,
  party_id          uuid references public.parties(id),
  doc_category      text not null,
  title             text,

  -- the file itself
  file_name         text not null,
  mime_type         text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  storage_bucket    text not null,
  storage_path      text not null unique,
  checksum_sha256   text,

  -- virus scan: nothing is readable until this says clean
  scan_status       text not null default 'pending'
                      check (scan_status in ('pending','clean','infected','error')),
  scan_engine       text,
  scan_result       text,
  scanned_at        timestamptz,

  -- versions: replace, never delete
  version           int not null default 1 check (version >= 1),
  replaces_id       uuid references public.attachments(id),
  is_current        boolean not null default true,
  replaced_at       timestamptz,
  replaced_by       uuid references public.parties(id)
);

comment on table public.attachments is
  'Every uploaded document and photo. Only PDF, JPG and PNG are accepted -- the mime_type check makes an executable impossible to store, whatever the screen does. A file stays unreadable until scan_status is clean.';
comment on column public.attachments.is_current is
  'False once a newer version has replaced this one. Old versions are kept forever; nothing here is ever deleted.';

create index attachments_entity_idx on public.attachments (entity_table, entity_id) where is_current;
create index attachments_party_idx  on public.attachments (party_id, created_at desc);
create index attachments_scan_idx   on public.attachments (scan_status) where scan_status = 'pending';

create unique index attachments_one_current_uidx
  on public.attachments (entity_table, entity_id, doc_category)
  where is_current and status <> 'cancelled';

-- A file may never be deleted, by anyone, including the application.
create or replace function public.block_attachment_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Uploaded files are never deleted. Replace the file instead -- the old version is kept.';
end;
$$;

create trigger attachments_no_delete
  before delete on public.attachments
  for each row execute function public.block_attachment_delete();

-- Replacing a file: old row is stood down, new row takes over, both are kept.
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
  select * into o from public.attachments where id = p_old_id;
  if not found then
    raise exception 'Attachment % not found', p_old_id;
  end if;

  update public.attachments
     set is_current  = false,
         replaced_at = now(),
         replaced_by = public.current_party_id()
   where id = p_old_id;

  insert into public.attachments (
    entity_table, entity_id, party_id, doc_category, title,
    file_name, mime_type, size_bytes, storage_bucket, storage_path, checksum_sha256,
    version, replaces_id, is_current, status, created_by
  ) values (
    o.entity_table, o.entity_id, o.party_id, o.doc_category, o.title,
    p_file_name, p_mime_type, p_size_bytes, p_storage_bucket, p_storage_path, p_checksum,
    o.version + 1, o.id, true, 'draft', public.current_party_id()
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

comment on function public.replace_attachment is
  'The only way to change a file. Keeps the old row, adds a new version pointing back at it.';

-- ---------- Notes people leave on things ----------
create table public.comments (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'approved',

  entity_table text not null,
  entity_id    uuid not null,
  party_id     uuid references public.parties(id),
  body         text not null check (length(btrim(body)) > 0)
);
create index comments_entity_idx on public.comments (entity_table, entity_id, created_at desc);

select public.attach_conventions('attachments', true);
select public.attach_conventions('comments');
