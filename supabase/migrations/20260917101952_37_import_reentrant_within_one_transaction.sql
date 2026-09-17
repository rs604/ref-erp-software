-- ============================================================
-- 37 LOADING TWO YEARS IN ONE GO FAILED
--
-- busy_import_fy built a temp table marked "on commit drop", which is
-- only cleared when the transaction ENDS. Raghbir keeps the current year
-- and one prior on the PC, so the sync sends two years together -- and
-- the second call died on "relation _incoming already exists".
--
-- The scratch table is now cleared at the start of every call, so the
-- function can be called as many times in one go as there are years.
-- ============================================================

create or replace function public.busy_import_fy(
  p_batch_id uuid,
  p_company  text,
  p_fy       text,
  p_rows     jsonb
)
returns table (inserted int, updated int, edited int, deleted int, restored int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_role text; v_before bigint; v_after bigint; v_touched int;
  v_edited int := 0; v_deleted int := 0; v_restored int := 0;
begin
  begin
    v_role := coalesce(auth.role(), current_user);
  exception when others then
    v_role := current_user;
  end;

  if not (v_role in ('service_role','postgres','supabase_admin')
          or public.has_permission('busy_data.import')
          or public.is_owner()) then
    raise exception 'You do not have permission to import Busy files.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;
  if p_fy is null or btrim(p_fy) = '' then
    raise exception 'A financial year must be named. Without it the comparison could reach into years that are not in this file.'
      using errcode = 'check_violation';
  end if;

  -- Cleared first, so several years can be loaded in one transaction.
  drop table if exists _incoming;

  create temp table _incoming on commit drop as
  select
    r->>'vch_type'                             as vch_type,
    r->>'vch_no'                               as vch_no,
    (r->>'sr_no')::int                         as sr_no,
    r->>'doc_type'                             as doc_type,
    case when nullif(r->>'vch_date','') is null then null
         else to_date(r->>'vch_date', 'MM/DD/YY') end as vch_date,
    r->>'party'                                as party,
    r->>'item'                                 as item,
    nullif(r->>'description','')               as description,
    (r->>'qty')::numeric                       as qty,
    (r->>'rate')::numeric                      as rate,
    (r->>'amount')::numeric                    as amount,
    (r->>'cgst')::numeric                      as cgst,
    (r->>'sgst')::numeric                      as sgst,
    (r->>'igst')::numeric                      as igst,
    (r->>'gst_rate')::numeric                  as gst_rate,
    (r->>'vch_total')::numeric                 as vch_total,
    r->>'search_text'                          as search_text,
    r->>'source_file'                          as source_file
  from jsonb_array_elements(p_rows) r;

  -- 1. Record edits BEFORE overwriting, so the old value survives.
  insert into public.busy_history_changes (history_id, batch_id, field, old_value, new_value)
  select h.id, p_batch_id, c.field, c.oldv, c.newv
  from public.busy_history h
  join _incoming i
    on i.vch_type = h.vch_type and i.vch_no = h.vch_no and i.sr_no = h.sr_no
  cross join lateral (values
    ('qty',    h.qty::text,    i.qty::text),
    ('rate',   h.rate::text,   i.rate::text),
    ('amount', h.amount::text, i.amount::text)
  ) as c(field, oldv, newv)
  where h.company = p_company and h.fy = p_fy
    and c.oldv is distinct from c.newv;
  get diagnostics v_edited = row_count;

  select count(*) into v_before from public.busy_history;

  -- 2. Insert or update everything in the file.
  insert into public.busy_history (
    company, fy, doc_type, vch_type, vch_no, vch_date, party, sr_no, item,
    description, qty, rate, amount, cgst, sgst, igst, gst_rate, vch_total,
    search_text, source_file, import_batch_id)
  select p_company, p_fy, i.doc_type, i.vch_type, i.vch_no, i.vch_date, i.party,
         i.sr_no, i.item, i.description, i.qty, i.rate, i.amount, i.cgst, i.sgst,
         i.igst, i.gst_rate, i.vch_total, i.search_text, i.source_file, p_batch_id
  from _incoming i
  on conflict (company, fy, vch_type, vch_no, sr_no) do update set
    doc_type = excluded.doc_type, vch_date = excluded.vch_date,
    party = excluded.party, item = excluded.item,
    description = excluded.description, qty = excluded.qty,
    rate = excluded.rate, amount = excluded.amount,
    cgst = excluded.cgst, sgst = excluded.sgst, igst = excluded.igst,
    gst_rate = excluded.gst_rate, vch_total = excluded.vch_total,
    search_text = excluded.search_text, source_file = excluded.source_file,
    import_batch_id = excluded.import_batch_id, imported_at = now();
  get diagnostics v_touched = row_count;
  select count(*) into v_after from public.busy_history;

  -- 3. A row that had been marked deleted and is back in the file.
  with back as (
    update public.busy_history h
       set deleted_at = null, restored_at = now(), deleted_in_batch_id = null
      from _incoming i
     where h.company = p_company and h.fy = p_fy
       and i.vch_type = h.vch_type and i.vch_no = h.vch_no and i.sr_no = h.sr_no
       and h.deleted_at is not null
    returning h.id
  )
  insert into public.busy_history_changes (history_id, batch_id, field, old_value, new_value)
  select id, p_batch_id, 'restored', 'deleted', 'present again' from back;
  get diagnostics v_restored = row_count;

  -- 4. THE SWEEP. Scoped to this company and THIS YEAR only. A year that
  --    is not in this upload is never looked at, so taking old years off
  --    the PC can never mark them deleted.
  with gone as (
    update public.busy_history h
       set deleted_at = now(), deleted_in_batch_id = p_batch_id
     where h.company = p_company
       and h.fy = p_fy
       and h.deleted_at is null
       and not exists (
         select 1 from _incoming i
          where i.vch_type = h.vch_type and i.vch_no = h.vch_no and i.sr_no = h.sr_no)
    returning h.id
  )
  insert into public.busy_history_changes (history_id, batch_id, field, old_value, new_value)
  select id, p_batch_id, 'deleted', 'present', 'no longer in the Busy file' from gone;
  get diagnostics v_deleted = row_count;

  -- 5. This year was seen today, so it is still being checked.
  insert into public.busy_financial_years (company, fy)
  values (p_company, p_fy)
  on conflict (company, fy) do update set last_seen_at = now();

  inserted := (v_after - v_before)::int;
  updated  := v_touched - inserted;
  edited   := v_edited;
  deleted  := v_deleted;
  restored := v_restored;
  return next;
end;
$$;

revoke all on function public.busy_import_fy(uuid, text, text, jsonb) from public, anon;
