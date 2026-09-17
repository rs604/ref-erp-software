-- ============================================================
-- 40 AN IMPORT THAT WOULD LOSE ROWS NOW REFUSES
--
-- WHAT WAS FOUND, in the 200-row sample of the new parser output:
--
--   ledger rows : 80 rows -> 4 distinct keys.  76 would vanish (95%)
--   item rows   : 120 rows -> 119 distinct keys. 1 would vanish
--
-- The key is company + fy + vch_type + vch_no + sr_no, and:
--
--   * EVERY ledger row has an EMPTY vch_no. All 38 payments in the
--     sample share the key (19, '', 1), so 37 of them would overwrite
--     each other and the last one would win.
--   * vch_no is not unique among item rows either. Purchase bill 167
--     is TWO different bills -- ORIGINATIV SOLUTIONS on 24 Jun for
--     Rs 19,365, and B.R.TOOLS on 29 Jun for Rs 56,000.
--
-- This has been wrong since migration 27; the ledger rows only made it
-- obvious. The real fix is for the parser to output Busy's own VchCode,
-- which is the voucher's actual identity, so the key can become
-- company + fy + vch_code + sr_no. That is Raghbir's parser to change.
--
-- Until then, an import that would silently swallow rows STOPS and says
-- so. Losing three quarters of the payments quietly is far worse than a
-- refusal that names the problem.
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
  v_rows int; v_keys int; v_example text;
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

  drop table if exists _incoming;

  create temp table _incoming on commit drop as
  select
    coalesce(nullif(r->>'kind',''), 'item')    as kind,
    r->>'vch_type'                             as vch_type,
    r->>'vch_no'                               as vch_no,
    (r->>'sr_no')::int                         as sr_no,
    r->>'doc_type'                             as doc_type,
    case when nullif(r->>'vch_date','') is null then null
         else to_date(r->>'vch_date', 'MM/DD/YY') end as vch_date,
    r->>'party'                                as party,
    nullif(r->>'item','')                      as item,
    nullif(r->>'description','')               as description,
    nullif(r->>'ledger','')                    as ledger,
    nullif(r->>'ledger_group','')              as ledger_group,
    (r->>'debit')::numeric                     as debit,
    (r->>'credit')::numeric                    as credit,
    (r->>'qty')::numeric                       as qty,
    (r->>'rate')::numeric                      as rate,
    (r->>'amount')::numeric                    as amount,
    coalesce((r->>'is_lump_sum')::boolean, false) as is_lump_sum,
    (r->>'cgst')::numeric                      as cgst,
    (r->>'sgst')::numeric                      as sgst,
    (r->>'igst')::numeric                      as igst,
    (r->>'gst_rate')::numeric                  as gst_rate,
    (r->>'vch_total')::numeric                 as vch_total,
    r->>'search_text'                          as search_text,
    r->>'source_file'                          as source_file
  from jsonb_array_elements(p_rows) r;

  -- ---- THE GUARD: would this file lose rows to itself? ----
  select count(*) into v_rows from _incoming;
  select count(*) into v_keys from (
    select distinct vch_type, vch_no, sr_no from _incoming) d;

  if v_keys < v_rows then
    select 'voucher type ' || vch_type ||
           ', voucher number ' || case when coalesce(vch_no,'') = '' then '(blank)' else vch_no end ||
           ', line ' || sr_no || ' appears ' || count(*) || ' times'
      into v_example
    from _incoming
    group by vch_type, vch_no, sr_no
    having count(*) > 1
    order by count(*) desc
    limit 1;

    raise exception
      'This file holds % rows but only % of them can be told apart, so % would be silently overwritten. Nothing has been loaded. Example: %. The rows are identified by voucher type, voucher number and line, and Busy leaves the voucher number blank on payments and journals, and re-uses it across bills. The parser needs to send Busy''s own VchCode so each voucher can be told from the next.',
      v_rows, v_keys, v_rows - v_keys, v_example
      using errcode = 'data_exception';
  end if;

  -- 1. Record real edits BEFORE overwriting. Compared as NUMBERS.
  insert into public.busy_history_changes (history_id, batch_id, field, old_value, new_value)
  select h.id, p_batch_id, c.field, c.oldv::text, c.newv::text
  from public.busy_history h
  join _incoming i
    on i.vch_type = h.vch_type and i.vch_no = h.vch_no and i.sr_no = h.sr_no
  cross join lateral (values
    ('qty',    h.qty,    i.qty),
    ('rate',   h.rate,   i.rate),
    ('amount', h.amount, i.amount)
  ) as c(field, oldv, newv)
  where h.company = p_company and h.fy = p_fy
    and c.oldv is distinct from c.newv;
  get diagnostics v_edited = row_count;

  select count(*) into v_before from public.busy_history;

  insert into public.busy_history (
    company, fy, kind, doc_type, vch_type, vch_no, vch_date, party, sr_no, item,
    description, ledger, ledger_group, debit, credit, qty, rate, amount,
    is_lump_sum, cgst, sgst, igst, gst_rate, vch_total,
    search_text, source_file, import_batch_id)
  select p_company, p_fy, i.kind, i.doc_type, i.vch_type, i.vch_no, i.vch_date,
         i.party, i.sr_no, i.item, i.description, i.ledger, i.ledger_group,
         i.debit, i.credit, i.qty, i.rate, i.amount, i.is_lump_sum,
         i.cgst, i.sgst, i.igst, i.gst_rate, i.vch_total,
         i.search_text, i.source_file, p_batch_id
  from _incoming i
  on conflict (company, fy, vch_type, vch_no, sr_no) do update set
    kind = excluded.kind,
    doc_type = excluded.doc_type, vch_date = excluded.vch_date,
    party = excluded.party, item = excluded.item,
    description = excluded.description,
    ledger = excluded.ledger, ledger_group = excluded.ledger_group,
    debit = excluded.debit, credit = excluded.credit,
    qty = excluded.qty, rate = excluded.rate, amount = excluded.amount,
    is_lump_sum = excluded.is_lump_sum,
    cgst = excluded.cgst, sgst = excluded.sgst, igst = excluded.igst,
    gst_rate = excluded.gst_rate, vch_total = excluded.vch_total,
    search_text = excluded.search_text, source_file = excluded.source_file,
    import_batch_id = excluded.import_batch_id, imported_at = now();
  get diagnostics v_touched = row_count;
  select count(*) into v_after from public.busy_history;

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
