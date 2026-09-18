-- ============================================================
-- 50 A YEAR ARRIVES IN CHUNKS, AND IS STILL COMPARED AS A WHOLE
--
-- REF 2025-26 is 7,219 rows. Sent as one call it was refused with
-- "canceling statement due to statement timeout": a signed-in user gets
-- 8 seconds, and parsing 7,219 rows of JSON, comparing them against what
-- is held, upserting them and sweeping the year does not fit in 8.
--
-- THE RULE THAT MUST NOT BEND: a year is compared as a WHOLE. Anything
-- missing from the batch is marked deleted in Busy, so a year compared in
-- halves would mark the other half gone. That rule is why the import is
-- built the way it is and it does not change here.
--
-- Chunking the ARRIVAL does not break it, as long as the COMPARISON still
-- happens once, over the whole year, at the end. So:
--
--   busy_import_stage()     a few hundred rows at a time, into a staging
--                           table keyed by the batch. Small, fast, well
--                           inside 8 seconds. Nothing is compared, nothing
--                           is swept, and busy_history is not touched at all
--
--   busy_import_finalise()  runs ONCE, when every chunk has landed. Every
--                           guard, the edit detection, the upsert and the
--                           sweep, all against the whole year in one
--                           transaction
--
-- IF ANY CHUNK FAILS, finalise is never called, so busy_history is never
-- touched. Nothing half-loaded -- not because a transaction rolled back
-- across separate calls, which it cannot, but because nothing reaches the
-- real table until the whole year is present.
--
-- The three guards get STRONGER for the move. They now see the whole year
-- at once rather than one call's worth: a duplicate key spanning two
-- chunks, or two parser versions in two different chunks, is now caught.
-- Before, each call only checked itself.
-- ============================================================

-- ---------- Where a year waits until all of it has arrived ----------
-- Deliberately not given the usual five columns. This is not a record of
-- anything; it is a landing strip, emptied the moment the year is applied.
create table if not exists public.busy_import_staging (
  batch_id       uuid not null,
  company        text not null,
  fy             text not null,
  staged_at      timestamptz not null default now(),
  kind           text,
  vch_code       text,
  vch_type       text,
  vch_no         text,
  sr_no          int,
  doc_type       text,
  vch_date       date,
  party          text,
  item           text,
  description    text,
  ledger         text,
  ledger_group   text,
  debit          numeric,
  credit         numeric,
  qty            numeric,
  rate           numeric,
  amount         numeric,
  is_lump_sum    boolean,
  cgst           numeric,
  sgst           numeric,
  igst           numeric,
  gst_rate       numeric,
  vch_total      numeric,
  search_text    text,
  source_file    text,
  parser_version text
);

create index if not exists busy_import_staging_batch_idx
  on public.busy_import_staging (batch_id);

comment on table public.busy_import_staging is
  'Where a year waits while the rest of it is still arriving. A year is sent a few hundred rows at a time because a signed-in user only gets 8 seconds per call, but it is still compared as a whole: nothing moves from here into busy_history until every chunk has landed. If a chunk fails, finalise is never called and busy_history is untouched.';

alter table public.busy_import_staging enable row level security;

-- Nobody reads this table from a screen. It is written and read by the
-- import functions, which are security definer and check permission
-- themselves. No policy is granted, so RLS denies everything else.

-- ---------- One chunk arrives ----------
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
    r->>'vch_code', r->>'vch_type', r->>'vch_no', (r->>'sr_no')::int, r->>'doc_type',
    case
      when nullif(r->>'vch_date','') is null then null
      -- The parser sends 2015-04-01; it used to send Busy's own 04/01/15.
      -- Both are read, and the shape decides which -- never a guess.
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

comment on function public.busy_import_stage(uuid, text, text, jsonb) is
  'Takes one chunk of a year and parks it. Touches nothing that anyone can see. Call it as many times as the year needs, then call busy_import_finalise once.';

-- ---------- The whole year is here: compare it, once ----------
-- 120 seconds rather than the 8 a signed-in user gets. This is one call at
-- the end of a load the person is watching, not something a screen does.
create or replace function public.busy_import_finalise(
  p_batch_id uuid,
  p_company  text,
  p_fy       text
)
returns table (inserted int, updated int, edited int, deleted int, restored int)
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '120s'
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
  select kind, vch_code, vch_type, vch_no, sr_no, doc_type, vch_date, party,
         item, description, ledger, ledger_group, debit, credit, qty, rate,
         amount, is_lump_sum, cgst, sgst, igst, gst_rate, vch_total,
         search_text, source_file, parser_version
  from public.busy_import_staging
  where batch_id = p_batch_id and company = p_company and fy = p_fy;

  select count(*) into v_rows from _incoming;
  if v_rows = 0 then
    raise exception
      'Nothing was staged for this batch, so there is nothing to compare. A year is compared against what arrives, and an empty year would mark every row already held as deleted. Nothing has been loaded.'
      using errcode = 'data_exception';
  end if;

  -- ---- One parser per batch. Now judged across the WHOLE year ----
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
      v_blank, v_rows
      using errcode = 'data_exception';
  end if;

  -- ---- THE GUARD: would this file lose rows? Across the whole year ----
  select count(*) into v_keys from (select distinct vch_code, sr_no from _incoming) d;

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

  -- THE SWEEP. ONCE, over the whole year, with every chunk present.
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

  if v_version is not null then
    update public.busy_import_batches
       set parser_version = v_version
     where id = p_batch_id;
  end if;

  insert into public.busy_financial_years (company, fy)
  values (p_company, p_fy)
  on conflict (company, fy) do update set last_seen_at = now();

  -- The landing strip is cleared. The year is in busy_history now.
  delete from public.busy_import_staging where batch_id = p_batch_id;

  inserted := (v_after - v_before)::int;
  updated  := v_touched - inserted;
  edited   := v_edited;
  deleted  := v_deleted;
  restored := v_restored;
  return next;
end;
$$;

revoke all on function public.busy_import_finalise(uuid, text, text) from public, anon;
grant execute on function public.busy_import_finalise(uuid, text, text) to authenticated, service_role;

comment on function public.busy_import_finalise(uuid, text, text) is
  'Called once, when every chunk of a year has been staged. Every guard, the edit detection, the upsert and the deletion sweep, all against the whole year in one transaction. Until this runs, busy_history has not been touched at all.';

-- ---------- The old front door still works ----------
-- The parse service calls busy_import_fy with a whole year at once. It keeps
-- working: it stages and finalises in one call. That only fits inside the
-- timeout for the service, which runs as service_role and has none.
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
set statement_timeout = '120s'
as $$
begin
  perform public.busy_import_stage(p_batch_id, p_company, p_fy, p_rows);
  return query select * from public.busy_import_finalise(p_batch_id, p_company, p_fy);
end;
$$;

revoke all on function public.busy_import_fy(uuid, text, text, jsonb) from public, anon;
grant execute on function public.busy_import_fy(uuid, text, text, jsonb) to authenticated, service_role;

-- ---------- A year that was never finished does not linger ----------
create or replace function public.busy_import_abandon(p_batch_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_role text; v_gone int;
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

  delete from public.busy_import_staging where batch_id = p_batch_id;
  get diagnostics v_gone = row_count;

  -- Anything left behind by a run that was closed mid-way.
  delete from public.busy_import_staging where staged_at < now() - interval '1 day';
  return v_gone;
end;
$$;

revoke all on function public.busy_import_abandon(uuid) from public, anon;
grant execute on function public.busy_import_abandon(uuid) to authenticated, service_role;

comment on function public.busy_import_abandon(uuid) is
  'Throws away a part-arrived year. Nothing of it ever reached busy_history, so there is nothing to undo -- this only clears the landing strip.';