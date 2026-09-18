-- ============================================================
-- 53 TWO THINGS THE NEW FILE NEEDS, BOTH OF WHICH WOULD HAVE REFUSED IT
--
-- Found by running the new file's shape through the import BEFORE it was
-- sent, rather than after.
--
-- 1. kind = 'opening'
--    busy_history_kind_check allows 'item' and 'ledger' and nothing else.
--    The 1,447 opening-balance rows would have been refused, and with them
--    the whole batch they arrived in.
--
-- 2. sr_no as TEXT
--    sr_no is an integer. The new parser sends 'L1' on ledger rows, because
--    a debit or credit note produces an item row AND a ledger row from the
--    same voucher and the same line, and under a numeric line number those
--    two collided. 'L1' cannot be cast to an integer: the import would have
--    thrown on the first ledger row of the first batch.
--
-- The key is still company + fy + vch_code + sr_no. Only the type of one
-- part of it changes. Nothing is added to the key.
--
-- sr_no also becomes NOT NULL. A row whose key component is missing cannot
-- be told from another, and the duplicate guard counts distinct
-- (vch_code, sr_no) -- nulls would slip past it silently. The table is empty
-- for the one-time reload, so this costs nothing now and closes that hole
-- for good.
-- ============================================================

-- The two views that select sr_no have to stand aside for the type change.
drop view if exists public.busy_history_ref;
drop view if exists public.busy_history_rs;

-- ---------- (1) a third kind of row ----------
alter table public.busy_history drop constraint busy_history_kind_check;
alter table public.busy_history add constraint busy_history_kind_check
  check (kind in ('item','ledger','opening'));

comment on column public.busy_history.kind is
  'item = a line off a bill, challan or order, and the only kind price history shows. ledger = a posting from a payment, receipt or journal. opening = the balance a party carried into the year, out of Folio1, with no date and no voucher number.';

-- ---------- (2) the line number is text ----------
alter table public.busy_history
  alter column sr_no type text using sr_no::text;
alter table public.busy_import_staging
  alter column sr_no type text using sr_no::text;

alter table public.busy_history
  alter column sr_no set not null;

comment on column public.busy_history.sr_no is
  'The line within the voucher, as TEXT. Item lines are 1, 2, 3; ledger postings are L1, L2; an opening balance is 0. A debit or credit note produces an item row and a ledger row from the same voucher and the same line, so a purely numeric line number made those two the same row.';

-- ---------- the two views come back, unchanged but for the type ----------
create view public.busy_history_ref with (security_invoker = true) as
  select id, created_at, updated_at, created_by, status, company, fy, doc_type,
         vch_type, vch_no, vch_date, party, sr_no, item, description, qty, rate,
         amount, cgst, sgst, igst, gst_rate, vch_total, search_text, imported_at,
         source_file, import_batch_id, deleted_at, deleted_in_batch_id,
         restored_at, kind, ledger, ledger_group, debit, credit, is_lump_sum,
         vch_code
  from public.busy_history
  where company = 'REF' and deleted_at is null
    and (public.has_permission('busy_data.view') or public.is_owner());

create view public.busy_history_rs with (security_invoker = true) as
  select id, created_at, updated_at, created_by, status, company, fy, doc_type,
         vch_type, vch_no, vch_date, party, sr_no, item, description, qty, rate,
         amount, cgst, sgst, igst, gst_rate, vch_total, search_text, imported_at,
         source_file, import_batch_id, deleted_at, deleted_in_batch_id,
         restored_at, kind, ledger, ledger_group, debit, credit, is_lump_sum,
         vch_code
  from public.busy_history
  where company = 'RS' and deleted_at is null
    and (public.has_permission('busy_data.view') or public.is_owner());

grant select on public.busy_history_ref to authenticated;
grant select on public.busy_history_rs  to authenticated;

-- ---------- the import stops casting the line number to a number ----------
create or replace function public.busy_import_stage(
  p_batch_id uuid,
  p_company  text,
  p_fy       text,
  p_rows     jsonb
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text; v_staged int;
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

  if p_batch_id is null then
    raise exception 'A chunk must say which batch it belongs to, or the year cannot be put back together.'
      using errcode = 'check_violation';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;
  if p_fy is null or btrim(p_fy) = '' then
    raise exception 'A financial year must be named. Without it the comparison could reach into years that are not in this file.'
      using errcode = 'check_violation';
  end if;

  insert into public.busy_import_staging (
    batch_id, company, fy, kind, vch_code, vch_type, vch_no, sr_no, doc_type,
    vch_date, party, item, description, ledger, ledger_group, debit, credit,
    qty, rate, amount, is_lump_sum, cgst, sgst, igst, gst_rate, vch_total,
    search_text, source_file, parser_version)
  select
    p_batch_id, p_company, p_fy,
    coalesce(nullif(r->>'kind',''), 'item'),
    r->>'vch_code', r->>'vch_type', r->>'vch_no',
    -- TEXT. Ledger rows carry L1, an opening balance carries 0.
    r->>'sr_no',
    r->>'doc_type',
    case
      when nullif(r->>'vch_date','') is null then null
      when r->>'vch_date' ~ '^\d{4}-\d{2}-\d{2}' then (left(r->>'vch_date', 10))::date
      else to_date(r->>'vch_date', 'MM/DD/YY')
    end,
    r->>'party', nullif(r->>'item',''), nullif(r->>'description',''),
    nullif(r->>'ledger',''), nullif(r->>'ledger_group',''),
    (r->>'debit')::numeric, (r->>'credit')::numeric, (r->>'qty')::numeric,
    (r->>'rate')::numeric, (r->>'amount')::numeric,
    coalesce((r->>'is_lump_sum')::boolean, false),
    (r->>'cgst')::numeric, (r->>'sgst')::numeric, (r->>'igst')::numeric,
    (r->>'gst_rate')::numeric, (r->>'vch_total')::numeric,
    r->>'search_text', r->>'source_file', nullif(r->>'parser_version','')
  from jsonb_array_elements(p_rows) r;

  get diagnostics v_staged = row_count;
  return v_staged;
end;
$$;

revoke all on function public.busy_import_stage(uuid, text, text, jsonb) from public, anon;
grant execute on function public.busy_import_stage(uuid, text, text, jsonb) to authenticated, service_role;

-- ---------- a row with no line number cannot be told from another ----------
create or replace function public.busy_guard_sr_no()
returns trigger language plpgsql as $$
begin
  if coalesce(new.sr_no, '') = '' then
    raise exception 'A row arrived with no line number. The key is company, year, voucher code and line, so a row without one cannot be told from another. Nothing has been loaded.'
      using errcode = 'data_exception';
  end if;
  return new;
end;
$$;

drop trigger if exists busy_history_sr_no_guard on public.busy_history;
create trigger busy_history_sr_no_guard
  before insert or update on public.busy_history
  for each row execute function public.busy_guard_sr_no();