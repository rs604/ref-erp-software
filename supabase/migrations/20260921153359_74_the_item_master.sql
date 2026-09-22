-- ============================================================
-- 74 THE ITEM MASTER
--
-- Busy's own list of items -- Master1 rows with MasterType = 6 -- rather
-- than the items that happen to appear on an invoice. 2,897 of them,
-- REF 2,438 and RS 459.
--
-- The key is company + item_code. An item is one thing however many
-- years it has been sold in, so fy is not part of the key: it holds the
-- LATEST year the item was seen, which is what makes a dead item
-- visible as dead.
--
-- THE UNITS ARE CLEANED IN THE PARSER, NOT HERE. Pcs. / PCS / NOS are
-- one unit and the parser says so; both the clean unit and Busy's own
-- spelling are stored, because the screen shows the first and the
-- tooltip has to be able to show the second. Nothing is merged on this
-- side -- the ERP does not decide what Busy meant.
-- ============================================================

create table if not exists public.busy_items (
  company            text not null check (company in ('REF','RS')),
  item_code          text not null,
  fy                 text,                    -- the latest year it was seen in
  item               text not null,
  hsn                text,
  unit               text,                    -- cleaned: Pcs, Set, Metre, Roll, Feet
  unit_in_busy       text,                    -- what Busy actually holds
  alt_unit           text,
  alt_unit_in_busy   text,
  tax_category       text,
  busy_group         text,
  parser_version     text,
  loaded_at          timestamptz not null default now(),
  primary key (company, item_code)
);

create index if not exists busy_items_company_item on public.busy_items (company, item);
create index if not exists busy_items_company_hsn  on public.busy_items (company, hsn);

alter table public.busy_items enable row level security;

drop policy if exists busy_items_read on public.busy_items;
create policy busy_items_read on public.busy_items
  for select using (public.has_permission('busy_data.view') or public.is_owner());

revoke all on table public.busy_items from anon, authenticated;
grant select on table public.busy_items to authenticated;

-- The whole list, in one go. Upserted on company + item_code: the same
-- item seen again keeps its row and gains the newer year.
create or replace function public.busy_items_upload(p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_in  int;
  v_out int;
begin
  if not (public.has_permission('busy_data.import') or public.is_owner()) then
    raise exception 'You do not have permission to load Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'A list of rows is required.' using errcode = 'check_violation';
  end if;

  select count(*) into v_in from jsonb_array_elements(p_rows);

  with incoming as (
    select r->>'company'          as company,
           btrim(r->>'item_code')  as item_code,
           nullif(btrim(r->>'fy'), '')               as fy,
           btrim(r->>'item')                          as item,
           nullif(btrim(r->>'hsn'), '')              as hsn,
           nullif(btrim(r->>'unit'), '')             as unit,
           nullif(btrim(r->>'unit_in_busy'), '')     as unit_in_busy,
           nullif(btrim(r->>'alt_unit'), '')         as alt_unit,
           nullif(btrim(r->>'alt_unit_in_busy'), '') as alt_unit_in_busy,
           nullif(btrim(r->>'tax_category'), '')     as tax_category,
           nullif(btrim(r->>'busy_group'), '')       as busy_group,
           nullif(btrim(r->>'parser_version'), '')   as parser_version
    from jsonb_array_elements(p_rows) r
  ),
  clean as (
    select * from incoming
    where company in ('REF','RS') and item_code is not null and item_code <> ''
      and item is not null and item <> ''
  ),
  -- One row per key, keeping the latest year's spelling of everything.
  one as (
    select distinct on (company, item_code) *
    from clean order by company, item_code, fy desc nulls last
  ),
  done as (
    insert into public.busy_items as t
      (company, item_code, fy, item, hsn, unit, unit_in_busy, alt_unit,
       alt_unit_in_busy, tax_category, busy_group, parser_version, loaded_at)
    select company, item_code, fy, item, hsn, unit, unit_in_busy, alt_unit,
           alt_unit_in_busy, tax_category, busy_group, parser_version, now()
    from one
    on conflict (company, item_code) do update set
      -- never move the year backwards: a re-upload of an old file must not
      -- make a live item look dead
      fy               = greatest(excluded.fy, t.fy),
      item             = excluded.item,
      hsn              = excluded.hsn,
      unit             = excluded.unit,
      unit_in_busy     = excluded.unit_in_busy,
      alt_unit         = excluded.alt_unit,
      alt_unit_in_busy = excluded.alt_unit_in_busy,
      tax_category     = excluded.tax_category,
      busy_group       = excluded.busy_group,
      parser_version   = excluded.parser_version,
      loaded_at        = now()
    returning 1
  )
  select count(*) into v_out from done;

  return jsonb_build_object(
    'rows_in',  v_in,
    'rows_kept', v_out,
    'total',    (select count(*) from public.busy_items),
    'by_company', (select jsonb_object_agg(company, n)
                   from (select company, count(*) n from public.busy_items
                         group by company) c));
end;
$function$;

-- What the screen reads. The GST slab is pulled out of the tax category
-- so a slab that no longer exists can be named on the row.
create or replace function public.busy_items_list(p_company text)
returns table(item_code text, item text, hsn text, unit text, unit_in_busy text,
              alt_unit text, alt_unit_in_busy text, tax_category text,
              gst_rate numeric, busy_group text, fy text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  select i.item_code, i.item, i.hsn, i.unit, i.unit_in_busy,
         i.alt_unit, i.alt_unit_in_busy, i.tax_category,
         nullif((regexp_match(coalesce(i.tax_category,''), '([0-9]+(?:\.[0-9]+)?)\s*%'))[1], '')::numeric,
         i.busy_group, i.fy
  from public.busy_items i
  where i.company = p_company
  order by i.item;
end;
$function$;

revoke all on function public.busy_items_upload(jsonb) from public;
revoke all on function public.busy_items_list(text) from public;
grant execute on function public.busy_items_upload(jsonb) to authenticated;
grant execute on function public.busy_items_list(text) to authenticated;
