-- ============================================================
-- 47 THE IMPORT READS THE DATE THE PARSER ACTUALLY SENDS
--
-- The updated parser converts the date itself and sends 2015-04-01.
-- The import was still reading every date as Busy's own MM/DD/YY, and
--
--     to_date('2015-04-01', 'MM/DD/YY')
--
-- does not return a wrong date. It RAISES: "date/time field value out of
-- range". So the whole load would have stopped on its first row, with a
-- raw database error on screen and nothing said about why.
--
-- Found by reading the parser against the import rather than by running
-- either. Nothing had been loaded yet when it was found.
--
-- The import now reads both shapes. Which one it is, is decided by the
-- shape of the text, never guessed. Everything else in this function is
-- unchanged from migration 45.
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
  v_rows int; v_keys int; v_blank int; v_example text;
  v_versions text[]; v_version text;
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
    r->>'vch_code'                             as vch_code,
    r->>'vch_type'                             as vch_type,
    r->>'vch_no'                               as vch_no,
    (r->>'sr_no')::int                         as sr_no,
    r->>'doc_type'                             as doc_type,
    case
      when nullif(r->>'vch_date','') is null then null
      -- The parser now converts the date itself and sends 2015-04-01. It used
      -- to send Busy's own 04/01/15. Both are read, so a rows file made by
      -- either version loads. Never guessed: the shape decides.
      when r->>'vch_date' ~ '^\d{4}-\d{2}-\d{2}'
        then (left(r->>'vch_date', 10))::date
      else to_date(r->>'vch_date', 'MM/DD/YY')
    end                                        as vch_date,
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
    r->>'source_file'                          as source_file,
    nullif(r->>'parser_version','')            as parser_version
  from jsonb_array_elements(p_rows) r;

  -- ---- One parser per batch. Two means two runs were stitched together ----
  select array_agg(distinct parser_version) into v_versions
  from _incoming where parser_version is not null;

  if array_length(v_versions, 1) > 1 then
    raise exception
      'This batch holds rows from % different parser versions (%). That means it was built from more than one run, and rows read by different parsers must not be mixed. Nothing has been loaded.',
      array_length(v_versions, 1), array_to_string(v_versions, ', ')
      using errcode = 'data_exception';
  end if;
  v_version := v_versions[1];

  -- ---- A file with no voucher identity cannot be loaded at all ----
  select count(*) into v_blank from _incoming where coalesce(vch_code,'') = '';
  if v_blank > 0 then
    raise exception
      '% of the % rows in this file have no voucher code. Without it one voucher cannot be told from the next, so nothing has been loaded. The parser must send Busy''s VchCode on every row.',
      v_blank, (select count(*) from _incoming)
      using errcode = 'data_exception';
  end if;

  -- ---- THE GUARD, kept permanently: would this file lose rows? ----
  select count(*) into v_rows from _incoming;
  select count(*) into v_keys from (
    select distinct vch_code, sr_no from _incoming) d;

  if v_keys < v_rows then
    select 'voucher code ' || vch_code || ', line ' || sr_no ||
           ' appears ' || count(*) || ' times'
      into v_example
    from _incoming
    group by vch_code, sr_no
    having count(*) > 1
    order by count(*) desc
    limit 1;

    raise exception
      'This file holds % rows but only % of them can be told apart, so % would be silently overwritten. Nothing has been loaded. Example: %.',
      v_rows, v_keys, v_rows - v_keys, v_example
      using errcode = 'data_exception';
  end if;

  -- 1. Record real edits BEFORE overwriting. Compared as NUMBERS.
  insert into public.busy_history_changes (history_id, batch_id, field, old_value, new_value)
  select h.id, p_batch_id, c.field, c.oldv::text, c.newv::text
  from public.busy_history h
  join _incoming i
    on i.vch_code = h.vch_code and i.sr_no = h.sr_no
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
    company, fy, kind, doc_type, vch_type, vch_code, vch_no, vch_date, party,
    sr_no, item, description, ledger, ledger_group, debit, credit,
    qty, rate, amount, is_lump_sum, cgst, sgst, igst, gst_rate, vch_total,
    search_text, source_file, import_batch_id)
  select p_company, p_fy, i.kind, i.doc_type, i.vch_type, i.vch_code, i.vch_no,
         i.vch_date, i.party, i.sr_no, i.item, i.description, i.ledger,
         i.ledger_group, i.debit, i.credit, i.qty, i.rate, i.amount,
         i.is_lump_sum, i.cgst, i.sgst, i.igst, i.gst_rate, i.vch_total,
         i.search_text, i.source_file, p_batch_id
  from _incoming i
  on conflict (company, fy, vch_code, sr_no) do update set
    kind = excluded.kind,
    doc_type = excluded.doc_type, vch_type = excluded.vch_type,
    vch_no = excluded.vch_no, vch_date = excluded.vch_date,
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
       and i.vch_code = h.vch_code and i.sr_no = h.sr_no
       and h.deleted_at is not null
    returning h.id
  )
  insert into public.busy_history_changes (history_id, batch_id, field, old_value, new_value)
  select id, p_batch_id, 'restored', 'deleted', 'present again' from back;
  get diagnostics v_restored = row_count;

  -- THE SWEEP. Still scoped to this company and THIS YEAR only.
  with gone as (
    update public.busy_history h
       set deleted_at = now(), deleted_in_batch_id = p_batch_id
     where h.company = p_company
       and h.fy = p_fy
       and h.deleted_at is null
       and not exists (
         select 1 from _incoming i
          where i.vch_code = h.vch_code and i.sr_no = h.sr_no)
    returning h.id
  )
  insert into public.busy_history_changes (history_id, batch_id, field, old_value, new_value)
  select id, p_batch_id, 'deleted', 'present', 'no longer in the Busy file' from gone;
  get diagnostics v_deleted = row_count;

  -- Which parser read this file, kept against the batch.
  if p_batch_id is not null and v_version is not null then
    update public.busy_import_batches
       set parser_version = v_version
     where id = p_batch_id;
  end if;

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
