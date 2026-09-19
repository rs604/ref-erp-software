-- ============================================================
-- 70 AN ORDER IS NOT A SALE
--
-- Migration 69 matched documents with `doc_type like 'Sales%'`. There is
-- a second document type beginning with those letters: SALES ORDER.
-- 1,154 item rows, 3.52 crore, none of it sold. Purchase Order is the
-- same trap on the other side: 629 rows, 12.69 crore merely ordered.
--
-- The items report came out at 24.78 crore against net sales of 21.34
-- crore -- and it was the parts-against-the-whole check that said so,
-- within a minute of being written, on my own new bug. That is the
-- argument for the check being standard.
--
-- Prefixes are gone. Every document type is named in full. Orders and
-- challans are deliberately absent from every money figure: an order is
-- an intention and a challan is a movement, and neither is a sale.
-- ============================================================

create or replace function public.busy_vouchers(p_company text)
returns table(fy text, vch_code text, vch_date date, doc_type text, doc_kind text,
              counterparty text, taxable numeric, tax numeric, gross numeric)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  select h.fy, h.vch_code, max(h.vch_date), min(h.doc_type),
         case when min(h.doc_type) = 'Sales Invoice'             then 'sale'
              when min(h.doc_type) in ('Credit Note',
                                       'Credit Note (no stock)') then 'credit_note'
              when min(h.doc_type) in ('Purchase Bill',
                                       'Purchase (no stock)')    then 'purchase'
              when min(h.doc_type) = 'Debit Note'                then 'debit_note'
              else 'other' end,
         max(h.ledger) filter (where coalesce(h.ledger_group,'') ilike '%Debtor%'
                                  or coalesce(h.ledger_group,'') ilike '%Creditor%'),
         abs(coalesce(sum(coalesce(h.debit,0) - coalesce(h.credit,0))
               filter (where public.busy_is_value_line(h.ledger_group, h.ledger)), 0)),
         abs(coalesce(sum(coalesce(h.debit,0) - coalesce(h.credit,0))
               filter (where public.busy_is_tax_line(h.ledger_group)), 0)),
         abs(coalesce(sum(coalesce(h.debit,0) - coalesce(h.credit,0))
               filter (where coalesce(h.ledger_group,'') ilike '%Debtor%'
                          or coalesce(h.ledger_group,'') ilike '%Creditor%'), 0))
  from public.busy_history h
  where h.company = p_company and h.kind = 'ledger' and h.deleted_at is null
    and h.vch_date is not null
    and h.doc_type in ('Sales Invoice', 'Credit Note', 'Credit Note (no stock)',
                       'Purchase Bill', 'Purchase (no stock)', 'Debit Note')
  group by h.fy, h.vch_code;
end;
$function$;


drop function if exists public.busy_items_sold(text);

create function public.busy_items_sold(p_company text)
returns table(item text, times_sold bigint, gross_value numeric,
              credit_notes numeric, total_value numeric,
              last_sold_to text, last_sold_on date, last_rate numeric)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    select h.item, h.party, h.vch_date, h.rate, coalesce(h.amount,0) as amount,
           (h.doc_type = 'Sales Invoice') as is_sale,
           case when h.doc_type = 'Sales Invoice'
                then row_number() over (partition by h.item
                       order by case when h.doc_type = 'Sales Invoice' then h.vch_date end
                                desc nulls last)
           end as rn
    from public.busy_history h
    where h.company = p_company and h.kind = 'item' and h.deleted_at is null
      and h.item is not null
      and h.doc_type in ('Sales Invoice', 'Credit Note', 'Credit Note (no stock)')
  )
  select l.item,
         count(*) filter (where l.is_sale),
         coalesce(sum(l.amount) filter (where l.is_sale), 0),
         coalesce(sum(l.amount) filter (where not l.is_sale), 0),
         coalesce(sum(l.amount) filter (where l.is_sale), 0)
           - coalesce(sum(l.amount) filter (where not l.is_sale), 0),
         max(l.party)    filter (where l.rn = 1),
         max(l.vch_date) filter (where l.is_sale),
         max(l.rate)     filter (where l.rn = 1)
  from lines l
  group by l.item
  having count(*) filter (where l.is_sale) > 0
  order by coalesce(sum(l.amount) filter (where l.is_sale), 0)
         - coalesce(sum(l.amount) filter (where not l.is_sale), 0) desc;
end;
$function$;


drop function if exists public.busy_item_sales(text, text);

create function public.busy_item_sales(p_company text, p_item text)
returns table(vch_date date, party text, vch_no text, description text,
              qty numeric, rate numeric, amount numeric, is_lump_sum boolean,
              is_return boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  if p_item is null or btrim(p_item) = '' then
    raise exception 'An item must be named.' using errcode = 'check_violation';
  end if;

  return query
  select h.vch_date, h.party, h.vch_no, h.description,
         h.qty, h.rate, h.amount, coalesce(h.is_lump_sum, false),
         (h.doc_type <> 'Sales Invoice')
  from public.busy_history h
  where h.company = p_company and h.kind = 'item' and h.deleted_at is null
    and h.item = p_item
    and h.doc_type in ('Sales Invoice', 'Credit Note', 'Credit Note (no stock)')
  order by h.vch_date desc
  limit 500;
end;
$function$;


create or replace function public.busy_customer_detail(p_company text, p_customer text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_out jsonb;
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;
  if p_customer is null or btrim(p_customer) = '' then
    raise exception 'A customer must be named.' using errcode = 'check_violation';
  end if;

  with v as (
    select * from public.busy_vouchers(p_company)
    where counterparty = p_customer and doc_kind in ('sale','credit_note')
  ),
  years as (
    select jsonb_agg(jsonb_build_object('fy', fy, 'gross', gross, 'credit_notes', cn,
                                        'value', gross - cn, 'invoices', n) order by fy) y
    from (select fy,
                 round(sum(taxable) filter (where doc_kind='sale')) gross,
                 round(coalesce(sum(taxable) filter (where doc_kind='credit_note'),0)) cn,
                 count(*) filter (where doc_kind='sale') n
          from v group by fy) a
  ),
  invs as (
    select jsonb_agg(jsonb_build_object('date', vch_date, 'vch_no', vch_code,
                                        'kind', doc_kind, 'what', doc_type,
                                        'net', round(taxable), 'gross', round(gross))
                     order by vch_date desc) i
    from (select * from v order by vch_date desc limit 200) b
  ),
  items as (
    select jsonb_agg(jsonb_build_object('item', item, 'times', n, 'value', value)
                     order by value desc) t
    from (
      select h.item, count(*) filter (where h.doc_type = 'Sales Invoice') n,
             round(sum(case when h.doc_type = 'Sales Invoice' then coalesce(h.amount,0)
                            else -coalesce(h.amount,0) end)) value
      from public.busy_history h
      where h.company = p_company and h.kind = 'item' and h.deleted_at is null
        and h.doc_type in ('Sales Invoice','Credit Note','Credit Note (no stock)')
        and h.party = p_customer and h.item is not null
      group by h.item
      order by sum(case when h.doc_type = 'Sales Invoice' then coalesce(h.amount,0)
                        else -coalesce(h.amount,0) end) desc
      limit 10
    ) c
  )
  select jsonb_build_object(
    'company',  p_company,
    'customer', p_customer,
    'years',    coalesce((select y from years), '[]'::jsonb),
    'invoices', coalesce((select i from invs),  '[]'::jsonb),
    'items',    coalesce((select t from items), '[]'::jsonb))
  into v_out;

  return v_out;
end;
$function$;

revoke all on function public.busy_items_sold(text) from public;
revoke all on function public.busy_item_sales(text, text) from public;
grant execute on function public.busy_items_sold(text) to authenticated;
grant execute on function public.busy_item_sales(text, text) to authenticated;
