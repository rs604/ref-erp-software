-- ============================================================
-- 39 LEDGER ROWS — AND GST ACTUALLY PAID
--
-- The parser now returns two kinds of row. Item rows are unchanged and
-- still come to 21,307 for REF and 1,425 for RS. Ledger rows are the
-- postings from payments (type 19) and journals (type 16), which is what
-- makes "GST actually paid" possible at all.
--
-- WHY is_lump_sum STOPS BEING WORKED OUT HERE:
-- it was a generated column, qty = 0 and amount <> 0. EVERY ledger row
-- fits that -- all 80 in the sample -- so every payment posting would
-- have been labelled a lump-sum sale. The parser sets it properly now,
-- so the derived version is not just redundant, it is wrong.
-- ============================================================

alter table public.busy_history
  add column kind         text not null default 'item' check (kind in ('item','ledger')),
  add column ledger       text,
  add column ledger_group text,
  add column debit        numeric(18,4),
  add column credit       numeric(18,4);

comment on column public.busy_history.kind is
  'item = a line from a bill, challan or order. ledger = a posting from a payment or journal. A ledger row has no quantity, rate, item or description, so it must NEVER appear in price history.';
comment on column public.busy_history.ledger is
  'The ledger name as Busy holds it. GST is found BY NAME, never by code -- the code differs in every company file.';
comment on column public.busy_history.debit is
  'The positive side of the posting. On a GST payment the GST ledger is debited, and that debit is the money that actually left the bank.';

create index busy_history_kind_idx on public.busy_history (company, kind);
create index busy_history_ledger_idx on public.busy_history (company, upper(ledger), vch_type)
  where kind = 'ledger';

-- The two company views select *, so they hold the old column open.
drop view if exists public.busy_history_ref;
drop view if exists public.busy_history_rs;

-- The parser now supplies this. See the note at the top.
alter table public.busy_history drop column is_lump_sum;
alter table public.busy_history
  add column is_lump_sum boolean not null default false;
comment on column public.busy_history.is_lump_sum is
  'Set by the parser: a line carrying real money with no quantity -- a complete machine billed as one job. Always false on a ledger row, which is why this is no longer worked out from qty and amount here.';

create view public.busy_history_ref as
select * from public.busy_history
where company = 'REF' and deleted_at is null
  and (public.has_permission('busy_data.view') or public.is_owner());

create view public.busy_history_rs as
select * from public.busy_history
where company = 'RS' and deleted_at is null
  and (public.has_permission('busy_data.view') or public.is_owner());

comment on view public.busy_history_ref is
  'Raghbir Erectors & Fabricators only, and only for someone holding busy_data.view. The base table stays unreadable, so no screen can combine the two firms.';
comment on view public.busy_history_rs is
  'RS Industries only. Two legally separate firms -- no report may ever combine them, and no screen could.';

grant select on public.busy_history_ref to authenticated;
grant select on public.busy_history_rs  to authenticated;

-- Which ledger name means GST. A setting, so a renamed ledger is not a
-- code change.
alter table public.busy_sync_settings
  add column gst_ledger_prefix text not null default 'GST PAYABLE';
comment on column public.busy_sync_settings.gst_ledger_prefix is
  'A ledger whose name starts with this is the GST control account. Matched by NAME because the Busy code differs per company file.';

-- ---------- Price questions only ever see item rows ----------
create or replace view public.busy_item_rate_stats as
select company, item, count(*)::int as priced_rows,
       (percentile_cont(0.5) within group (order by rate))::numeric(18,4) as median_rate
from public.busy_history
where kind = 'item' and rate is not null and rate > 0
  and coalesce(qty,0) > 0 and deleted_at is null
group by company, item;

create or replace function public.busy_search(
  p_company    text,
  p_query      text default null,
  p_party      text default null,
  p_doc_type   text default null,
  p_date_from  date default null,
  p_date_to    date default null,
  p_limit      int  default 200,
  p_offset     int  default 0
)
returns table (
  id uuid, company text, fy text, doc_type text, vch_no text, vch_date date,
  party text, item text, description text, qty numeric, rate numeric,
  amount numeric, is_lump_sum boolean, is_extreme_rate boolean,
  median_rate numeric, match_tier int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS. The menu path decides it, not a filter.'
      using errcode = 'check_violation';
  end if;

  return query
  with q as (
    select btrim(coalesce(p_query,''))    as raw,
           public.busy_normalise(p_query) as nq,
           public.busy_numbers(p_query)   as nums,
           (select extreme_rate_multiple from public.busy_sync_settings where id = 1) as mult,
           (select extreme_rate_min_rows from public.busy_sync_settings where id = 1) as minrows
  ),
  scoped as (
    select h.*, public.busy_normalise(h.search_text) as norm,
                public.busy_compact(h.search_text)   as comp
    from public.busy_history h
    where h.company = p_company
      and h.kind = 'item'          -- a ledger posting is not a price
      and h.deleted_at is null
      and (p_party     is null or h.party = p_party)
      and (p_doc_type  is null or h.doc_type = p_doc_type)
      and (p_date_from is null or h.vch_date >= p_date_from)
      and (p_date_to   is null or h.vch_date <= p_date_to)
  ),
  judged as (
    select s.*,
      (select bool_and(s.norm ~ ('(^|[^0-9.])' || replace(n, '.', '\.') || '([^0-9.]|$)'))
         from unnest(q.nums) n) as numbers_ok,
      (q.raw <> '' and s.search_text ilike '%' || q.raw || '%') as hit_exact,
      (q.raw <> '' and
        (select bool_and(s.comp like '%' || public.busy_compact(w) || '%')
           from unnest(string_to_array(q.nq, ' ')) w
          where w <> '')) as hit_cleaned,
      (q.raw <> '' and cardinality(q.nums) = 0 and
        (select bool_and(exists (
            select 1 from unnest(string_to_array(s.norm, ' ')) rw
             where extensions.similarity(rw, w) > 0.5))
           from unnest(string_to_array(q.nq, ' ')) w
          where w <> '')) as hit_fuzzy,
      q.raw as raw, q.mult as mult, q.minrows as minrows
    from scoped s, q
  )
  select j.id, j.company, j.fy, j.doc_type, j.vch_no, j.vch_date,
         j.party, j.item, j.description, j.qty, j.rate, j.amount,
         j.is_lump_sum,
         (j.rate is not null and j.rate > 0
          and st.median_rate is not null
          and st.priced_rows >= j.minrows
          and j.rate > st.median_rate * j.mult) as is_extreme_rate,
         st.median_rate,
         case when j.raw = '' then 3
              when j.hit_exact then 1
              when j.hit_cleaned then 2
              else 3 end as match_tier
  from judged j
  left join public.busy_item_rate_stats st
         on st.company = j.company and st.item = j.item
  where j.raw = ''
     or (coalesce(j.numbers_ok, true)
         and (j.hit_exact or j.hit_cleaned or j.hit_fuzzy))
  order by match_tier, j.vch_date desc nulls last
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.busy_monthly_totals(p_company text)
returns table (
  fy text, month_start date, doc_type text,
  line_amount numeric, voucher_total numeric, voucher_tax numeric,
  voucher_count int, line_count int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;

  return query
  with lines as (
    select h.fy, date_trunc('month', h.vch_date)::date as month_start, h.doc_type,
           sum(coalesce(h.amount,0)) as line_amount,
           count(*)::int as line_count
    from public.busy_history h
    where h.company = p_company and h.kind = 'item'
      and h.vch_date is not null and h.deleted_at is null
    group by 1,2,3
  ),
  vouchers as (
    select v.fy, v.month_start, v.doc_type,
           sum(v.vch_total) as voucher_total,
           sum(v.tax)       as voucher_tax,
           count(*)::int    as voucher_count
    from (
      select distinct on (h.fy, h.vch_type, h.vch_no)
             h.fy,
             date_trunc('month', h.vch_date)::date as month_start,
             h.doc_type,
             coalesce(h.vch_total,0) as vch_total,
             coalesce(h.cgst,0) + coalesce(h.sgst,0) + coalesce(h.igst,0) as tax
      from public.busy_history h
      where h.company = p_company and h.kind = 'item'
        and h.vch_date is not null and h.deleted_at is null
      order by h.fy, h.vch_type, h.vch_no, h.vch_date
    ) v
    group by 1,2,3
  )
  select l.fy, l.month_start, l.doc_type, l.line_amount,
         coalesce(vc.voucher_total, 0), coalesce(vc.voucher_tax, 0),
         coalesce(vc.voucher_count, 0), l.line_count
  from lines l
  left join vouchers vc
    on vc.fy = l.fy and vc.month_start = l.month_start and vc.doc_type = l.doc_type
  order by l.month_start, l.doc_type;
end;
$$;

-- ---------- GST: what was computed, and what was actually paid ----------
-- The double-count trap applies here too: a journal with six postings
-- carries vch_total six times. So vch_total is NEVER used below. The
-- amount is the posting on the GST ledger itself -- debit and credit.
create or replace function public.busy_gst_ledger(p_company text)
returns table (
  fy text, month_start date, vch_date date, vch_no text, vch_type text,
  doc_type text, ledger text, debit numeric, credit numeric, net_amount numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare v_prefix text;
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;

  select upper(gst_ledger_prefix) into v_prefix
  from public.busy_sync_settings where id = 1;

  return query
  select h.fy,
         date_trunc('month', h.vch_date)::date as month_start,
         h.vch_date, h.vch_no, h.vch_type, h.doc_type,
         max(h.ledger) as ledger,
         sum(coalesce(h.debit,0))  as debit,
         sum(coalesce(h.credit,0)) as credit,
         sum(coalesce(h.debit,0)) - sum(coalesce(h.credit,0)) as net_amount
  from public.busy_history h
  where h.company = p_company
    and h.kind = 'ledger'
    and h.deleted_at is null
    and upper(h.ledger) like v_prefix || '%'
    and h.vch_type in ('19','16')
  group by h.fy, 2, h.vch_date, h.vch_no, h.vch_type, h.doc_type
  order by h.vch_date, h.vch_no;
end;
$$;

comment on function public.busy_gst_ledger(text) is
  'Every posting to the GST control ledger, one row per voucher. Type 19 is a PAYMENT -- the GST ledger is debited and that is money that actually left the bank. Type 16 is the monthly JOURNAL that computes the liability. Showing both together is the point: if they drift apart over time, input credit is not all being claimed. RS Industries has no GST ledger rows in this data, and an empty answer is correct, not a fault.';

revoke all on function public.busy_gst_ledger(text) from public, anon;
grant execute on function public.busy_gst_ledger(text) to authenticated;

-- ---------- The import carries the new columns ----------
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
