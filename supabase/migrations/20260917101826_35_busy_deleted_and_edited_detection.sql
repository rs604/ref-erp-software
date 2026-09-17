-- ============================================================
-- 35 DELETED AND EDITED INVOICES
--
-- Busy's own DeletedInfo table records only a date and an amount, not
-- the voucher number, so it cannot say WHAT went. We find out by
-- comparison instead: the sync uploads the whole current-year file, and
-- anything the ERP holds for that year which is no longer in the file
-- was deleted in Busy.
--
-- THE DANGEROUS PART, AND HOW IT IS PREVENTED:
-- Raghbir will remove old financial years from the Busy folder once the
-- import is checked. If the comparison ever ran against a year that was
-- not in the upload, every row of it would be marked deleted in one
-- sweep -- twenty thousand rows, silently, with no way to tell which
-- were real. So the sweep is scoped to ONE company and ONE year, both
-- named by the caller, and it physically cannot reach any other year.
-- A year that stops being uploaded is simply never compared again.
--
-- Nothing is ever removed. Deleted means a date in deleted_at.
-- ============================================================

alter table public.busy_history
  add column deleted_at timestamptz,
  add column deleted_in_batch_id uuid references public.busy_import_batches(id),
  add column restored_at timestamptz;

comment on column public.busy_history.deleted_at is
  'Set when a row the ERP holds is no longer in the Busy file for its own year. The row is NEVER removed -- an invoice that existed yesterday and is gone today is exactly the kind of thing this ERP exists to keep a record of.';
comment on column public.busy_history.restored_at is
  'Set if a row that had been marked deleted turns up again in a later upload. Both dates stay, so a row that came and went and came back still tells its own story.';

create index busy_history_deleted_idx on public.busy_history (company, deleted_at)
  where deleted_at is not null;

-- ---------- What changed on a row that stayed ----------
create table public.busy_history_changes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  status      public.record_status default 'completed',

  history_id  uuid not null references public.busy_history(id),
  batch_id    uuid references public.busy_import_batches(id),
  field       text not null check (field in ('qty','rate','amount','deleted','restored')),
  old_value   text,
  new_value   text
);
comment on table public.busy_history_changes is
  'One row per change the sync noticed on a line that is still in the file: quantity, rate or amount edited after the fact, plus the moment a row was marked deleted or turned up again. The old value is kept here, never overwritten.';
create index busy_history_changes_history_idx on public.busy_history_changes (history_id, created_at desc);

-- ---------- Which years are still being checked ----------
create table public.busy_financial_years (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'approved',

  company       text not null check (company in ('REF','RS')),
  fy            text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (company, fy)
);
comment on table public.busy_financial_years is
  'When each year was last actually present in an upload. A year that stops arriving is frozen: kept for good, never compared again, never touched. That is why a 2018 invoice can never change once the old files come off the PC.';

-- A year is frozen when it was not in the most recent successful sync for
-- its firm. Worked out, never typed, so nobody has to remember to set it.
create view public.busy_fy_status as
select y.company,
       y.fy,
       y.first_seen_at,
       y.last_seen_at,
       (select count(*) from public.busy_history h
         where h.company = y.company and h.fy = y.fy and h.deleted_at is null) as live_rows,
       (select count(*) from public.busy_history h
         where h.company = y.company and h.fy = y.fy and h.deleted_at is not null) as deleted_rows,
       (y.last_seen_at < coalesce(
          (select max(b.finished_at) from public.busy_import_batches b
            where b.company = y.company and b.status = 'completed'), y.last_seen_at)) as is_frozen
from public.busy_financial_years y
where public.has_permission('busy_data.view') or public.is_owner();

comment on view public.busy_fy_status is
  'Every financial year held, and whether it is still being checked for deletions or has been frozen because its file is no longer on the PC.';
grant select on public.busy_fy_status to authenticated;

-- ---------- Owner-only: what disappeared ----------
create view public.busy_deleted_rows as
select h.company, h.fy, h.doc_type, h.vch_no, h.vch_date, h.party, h.item,
       h.description, h.qty, h.rate, h.amount, h.deleted_at, h.restored_at,
       b.source_file, b.started_at as noticed_in_sync_at
from public.busy_history h
left join public.busy_import_batches b on b.id = h.deleted_in_batch_id
where h.deleted_at is not null
  and public.is_owner();

comment on view public.busy_deleted_rows is
  'Owner only. What was in the ERP and is no longer in Busy, and when we noticed. Sometimes a genuine correction, sometimes not -- either way it is worth knowing about, which is the whole reason this ERP exists.';
grant select on public.busy_deleted_rows to authenticated;

-- ---------- The import, with comparison ----------
-- The old entry point cannot detect deletions because it is not told which
-- year it is looking at. It is kept so nothing silently calls the wrong
-- thing, and it now says so.
create or replace function public.busy_import_rows(p_batch_id uuid, p_rows jsonb)
returns table (inserted int, updated int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Use busy_import_fy(batch, company, fy, rows) instead. This one cannot tell which year it is loading, so it cannot notice a deleted invoice.'
    using errcode = 'feature_not_supported';
end;
$$;

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

  -- The file's rows, shaped and typed once.
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

comment on function public.busy_import_fy(uuid, text, text, jsonb) is
  'Loads one financial year of one firm from the whole current file, and compares. Rows in the file are inserted or updated, and a changed quantity, rate or amount is written to busy_history_changes with its old value first. Rows the ERP holds for THIS year that are not in the file are marked deleted -- never removed. The comparison cannot reach any other year, which is what makes it safe to take old years off the PC.';

revoke all on function public.busy_import_fy(uuid, text, text, jsonb) from public, anon;

-- ---------- Deleted rows leave the everyday screens ----------
create or replace view public.busy_history_ref as
select * from public.busy_history
where company = 'REF' and deleted_at is null
  and (public.has_permission('busy_data.view') or public.is_owner());

create or replace view public.busy_history_rs as
select * from public.busy_history
where company = 'RS' and deleted_at is null
  and (public.has_permission('busy_data.view') or public.is_owner());

create or replace view public.busy_item_rate_stats as
select company, item, count(*)::int as priced_rows,
       (percentile_cont(0.5) within group (order by rate))::numeric(18,4) as median_rate
from public.busy_history
where rate is not null and rate > 0 and coalesce(qty,0) > 0 and deleted_at is null
group by company, item;
