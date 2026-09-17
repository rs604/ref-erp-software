-- ============================================================
-- 27 BUSY DATA — a read-only copy of Busy's own records
--
-- The ERP never writes to Busy. This table is a COPY of another
-- system's records, so nothing in it is ever edited from a screen.
--
-- THE RULE THAT CANNOT BE BROKEN: REF and RS Industries are two legally
-- separate firms and no screen may ever combine them. That is enforced
-- here rather than trusted to a filter -- see the grants at the bottom.
-- Signed-in users CANNOT read busy_history at all. They read one of two
-- company views, and the menu path decides which. There is no dropdown,
-- so there is nothing to set wrong.
-- ============================================================

create extension if not exists pg_trgm with schema extensions;

create table public.busy_history (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'completed',

  company       text not null check (company in ('REF','RS')),
  fy            text not null,
  doc_type      text not null,
  vch_type      text not null,
  vch_no        text not null,
  vch_date      date,
  party         text,
  sr_no         int not null,
  item          text,
  description   text,
  qty           numeric(18,4),
  rate          numeric(18,4),
  amount        numeric(18,4),
  cgst          numeric(18,4),
  sgst          numeric(18,4),
  igst          numeric(18,4),
  gst_rate      numeric(9,4),
  vch_total     numeric(18,4),
  search_text   text,

  imported_at     timestamptz not null default now(),
  source_file     text,
  import_batch_id uuid,

  -- A line with no quantity but a real amount is a lump-sum bill, not a
  -- cancelled row. Kept as a flag so a screen can say "no rate" instead
  -- of showing a rate of zero as though it were a price.
  is_lump_sum boolean generated always as
    (coalesce(qty,0) = 0 and coalesce(amount,0) <> 0) stored,

  -- Re-uploading the same file must never duplicate a row.
  unique (company, fy, vch_type, vch_no, sr_no)
);

comment on table public.busy_history is
  'A read-only copy of Busy Accounting''s own records. Names are stored EXACTLY as Busy has them -- no cleaning, no correction, no mapping to the ERP item master. Nothing here is ever edited from a screen.';
comment on column public.busy_history.vch_date is
  'Busy exports dates as MM/DD/YY. They are converted once, explicitly, on import -- never by an implicit cast, because a server reading day-first would silently turn 04/01/15 into 4 January.';
comment on column public.busy_history.search_text is
  'Upper-cased party + item + description, pre-built by the parser. Searching by item name alone is useless -- every steel line just says "PIPE" and the size, make and weight live in the description. This column is what search runs on.';
comment on column public.busy_history.is_lump_sum is
  'True where a line carries real money but no quantity -- a complete conveyor billed as one job. These are NOT cancelled rows and must not be hidden; they simply have no meaningful rate.';
comment on column public.busy_history.description is
  'Busy''s Desc1..Desc20 and Desc1SL..Desc4SL for this line, joined with " | ". These are columns on ItemDesc keyed on VchCode + SrNo, not rows beneath the item.';

create index busy_history_search_trgm_idx on public.busy_history
  using gin (search_text extensions.gin_trgm_ops);
create index busy_history_company_type_date_idx on public.busy_history (company, doc_type, vch_date desc);
create index busy_history_company_party_idx on public.busy_history (company, party);
create index busy_history_batch_idx on public.busy_history (import_batch_id);

-- updated_at only. The audit trigger is deliberately NOT attached: this is
-- a copy of someone else's records, and auditing 22,732 imported rows would
-- bury the real audit log. busy_import_batches is the record of what arrived.
create trigger busy_history_set_updated_at before update on public.busy_history
  for each row execute function public.set_updated_at();

-- ---------- One row per file that was loaded ----------
create table public.busy_import_batches (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  status           public.record_status default 'draft',

  company          text check (company in ('REF','RS')),
  fy               text,
  source_file      text not null,
  file_modified_at timestamptz,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  rows_read        int not null default 0,
  rows_inserted    int not null default 0,
  rows_updated     int not null default 0,
  error_message    text
);
comment on table public.busy_import_batches is
  'One row per Busy file loaded. This is where the last-sync time on every screen comes from, and where a silent failure becomes visible: status completed = it worked, cancelled = it failed.';
create index busy_import_batches_company_idx on public.busy_import_batches (company, started_at desc);

-- ---------- The sync schedule lives in the ERP, not on the PC ----------
create table public.busy_sync_settings (
  id                      int primary key default 1 check (id = 1),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  status                  public.record_status default 'approved',

  run_at_times            time[] not null default array['13:00','19:00']::time[],
  is_enabled              boolean not null default true,
  uploader_version        text,
  uploader_updated_at     timestamptz,
  busy_folder_hint        text,
  failure_email_after_days int not null default 3 check (failure_email_after_days > 0),
  extreme_rate_threshold  numeric(18,4) not null default 50000
);
comment on table public.busy_sync_settings is
  'The uploader reads its schedule from here on every run, so changing "twice a day" to "three times a day" is a setting and never a code change or a visit to that PC.';
comment on column public.busy_sync_settings.failure_email_after_days is
  'If the sync fails this many days running, Raghbir is emailed. Without it the sync could stop silently and nobody would find out until a price was needed.';
comment on column public.busy_sync_settings.extreme_rate_threshold is
  'Rates above this are FLAGGED on screen, never hidden. Some Busy rows are tonnes billed as kilograms; that is what Busy holds, so it stays.';

insert into public.busy_sync_settings (id) values (1) on conflict (id) do nothing;

-- ---------- Permission ----------
insert into public.permissions (key, sub_head, action, label, category) values
  ('busy_data.view',   'busy_data','view',  'View Busy Data','Busy Data'),
  ('busy_data.import', 'busy_data','create','Import Busy Files','Busy Data')
on conflict (key) do nothing;

-- ---------- Searching: numbers must match exactly ----------
-- 80X40X2.5 and 80X40X3 are different pipes. Fuzzy matching calls them 95%
-- similar and would show the wrong price. So every number in what was typed
-- must appear in the row before that row is offered at all.
create or replace function public.busy_normalise(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(
           regexp_replace(upper(coalesce(p_text,'')), '[^A-Z0-9.]+', ' ', 'g'),
           '\s+', ' ', 'g');
$$;
comment on function public.busy_normalise(text) is
  'Upper-case, punctuation to spaces, spaces collapsed. So 80X40X2.5, 80 x 40 x 2.5 and 80x40x2.5 all become the same thing.';

create or replace function public.busy_numbers(p_text text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(m[1] order by m[1]), '{}')
  from regexp_matches(upper(coalesce(p_text,'')), '([0-9]+(?:\.[0-9]+)?)', 'g') m;
$$;
comment on function public.busy_numbers(text) is
  'Every number in a piece of text. Used to make sure a size typed in the search box matches the row exactly before fuzzy matching is allowed anywhere near it.';

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
  amount numeric, is_lump_sum boolean, is_extreme_rate boolean, match_tier int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    select public.busy_normalise(p_query) as nq,
           public.busy_numbers(p_query)   as nums,
           (select extreme_rate_threshold from public.busy_sync_settings where id = 1) as thr
  )
  select h.id, h.company, h.fy, h.doc_type, h.vch_no, h.vch_date,
         h.party, h.item, h.description, h.qty, h.rate, h.amount,
         h.is_lump_sum,
         (h.rate is not null and h.rate > q.thr) as is_extreme_rate,
         case
           when p_query is null or btrim(p_query) = '' then 3
           when h.search_text ilike '%' || btrim(p_query) || '%' then 1
           when public.busy_normalise(h.search_text) like '%' || q.nq || '%' then 2
           else 3
         end as match_tier
  from public.busy_history h, q
  where h.company = p_company
    and (p_party    is null or h.party = p_party)
    and (p_doc_type is null or h.doc_type = p_doc_type)
    and (p_date_from is null or h.vch_date >= p_date_from)
    and (p_date_to   is null or h.vch_date <= p_date_to)
    and (
      p_query is null or btrim(p_query) = ''
      or (
        -- every number typed must be present, exactly
        (select bool_and(public.busy_normalise(h.search_text) ~ ('(^| )' || n || '($| )'))
           from unnest(q.nums) n)
        is not false
        and (
          h.search_text ilike '%' || btrim(p_query) || '%'
          or public.busy_normalise(h.search_text) like '%' || q.nq || '%'
          or (cardinality(q.nums) = 0
              and extensions.similarity(public.busy_normalise(h.search_text), q.nq) > 0.3)
          or (select bool_and(public.busy_normalise(h.search_text) like '%' || w || '%')
                from unnest(string_to_array(q.nq, ' ')) w
               where w <> '')
        )
      )
    )
  order by match_tier, h.vch_date desc nulls last
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
comment on function public.busy_search(text,text,text,text,date,date,int,int) is
  'Layered search: exact first, then the same text ignoring spacing and punctuation, then fuzzy for typos. Fuzzy is only ever reached when NO number was typed -- if a size was typed it must match exactly, because 80X40X2.5 and 80X40X3 are different pipes. Words may be typed in any order.';

-- ---------- Idempotent load ----------
create or replace function public.busy_import_rows(p_batch_id uuid, p_rows jsonb)
returns table (inserted int, updated int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_before bigint; v_after bigint; v_touched int;
begin
  if not (public.has_permission('busy_data.import') or public.is_owner()) then
    raise exception 'You do not have permission to import Busy files.'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_before from public.busy_history;

  with incoming as (
    select
      r->>'company'                              as company,
      r->>'fy'                                   as fy,
      r->>'doc_type'                             as doc_type,
      r->>'vch_type'                             as vch_type,
      r->>'vch_no'                               as vch_no,
      -- Busy writes MM/DD/YY. Converted explicitly, never by implicit cast.
      case when nullif(r->>'vch_date','') is null then null
           else to_date(r->>'vch_date', 'MM/DD/YY') end as vch_date,
      r->>'party'                                as party,
      (r->>'sr_no')::int                         as sr_no,
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
    from jsonb_array_elements(p_rows) r
  )
  insert into public.busy_history (
    company, fy, doc_type, vch_type, vch_no, vch_date, party, sr_no, item,
    description, qty, rate, amount, cgst, sgst, igst, gst_rate, vch_total,
    search_text, source_file, import_batch_id)
  select company, fy, doc_type, vch_type, vch_no, vch_date, party, sr_no, item,
         description, qty, rate, amount, cgst, sgst, igst, gst_rate, vch_total,
         search_text, source_file, p_batch_id
  from incoming
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

  inserted := (v_after - v_before)::int;
  updated  := v_touched - inserted;
  return next;
end;
$$;
comment on function public.busy_import_rows(uuid, jsonb) is
  'Loads parsed Busy rows. Keyed on company + fy + vch_type + vch_no + sr_no, so re-uploading the same file updates rows instead of duplicating them.';

-- ---------- The last-sync stamp every screen shows ----------
create view public.busy_last_sync
with (security_invoker = true) as
select company,
       max(finished_at) filter (where status = 'completed') as last_success_at,
       count(*) filter (where status = 'cancelled'
                          and started_at > now() - interval '7 days') as failures_last_7_days
from public.busy_import_batches
group by company;
comment on view public.busy_last_sync is
  'Every screen shows this as "as at 5:30 PM, 13 Sep". The data is current as of the last sync, not live, and no screen may imply otherwise.';

-- ---------- Security: the two firms can never meet ----------
alter table public.busy_history enable row level security;
alter table public.busy_import_batches enable row level security;
alter table public.busy_sync_settings enable row level security;

create policy busy_history_read on public.busy_history for select to authenticated
  using (public.has_permission('busy_data.view') or public.is_owner());

create policy busy_import_batches_read on public.busy_import_batches for select to authenticated
  using (public.has_permission('busy_data.view') or public.is_owner());
create policy busy_import_batches_write on public.busy_import_batches for all to authenticated
  using (public.has_permission('busy_data.import') or public.is_owner())
  with check (public.has_permission('busy_data.import') or public.is_owner());

create policy busy_sync_settings_read on public.busy_sync_settings for select to authenticated
  using (public.has_permission('busy_data.view') or public.is_owner());
create policy busy_sync_settings_write on public.busy_sync_settings for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- One view per firm. The menu path picks the view; there is no dropdown.
create view public.busy_history_ref
with (security_invoker = true) as
select * from public.busy_history where company = 'REF';

create view public.busy_history_rs
with (security_invoker = true) as
select * from public.busy_history where company = 'RS';

comment on view public.busy_history_ref is
  'Raghbir Erectors & Fabricators only. A screen under the REF menu reads this and can see nothing else.';
comment on view public.busy_history_rs is
  'RS Industries only. Two legally separate firms -- no report may ever combine them, and no screen could.';

-- This is the part that makes it a rule rather than a promise: signed-in
-- users cannot touch the base table, only the per-company views. A screen
-- that tried to combine the two firms would have nothing to select from.
revoke all on public.busy_history from authenticated, anon;
grant select on public.busy_history_ref to authenticated;
grant select on public.busy_history_rs  to authenticated;

-- Nothing here is ever written from a screen. The import runs as the
-- service role through busy_import_rows().
revoke insert, update, delete on public.busy_history_ref from authenticated, anon;
revoke insert, update, delete on public.busy_history_rs  from authenticated, anon;
revoke all on function public.busy_import_rows(uuid, jsonb) from public, anon;
