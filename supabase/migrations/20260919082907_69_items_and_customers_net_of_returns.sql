-- ============================================================
-- 69 ITEMS AND ONE CUSTOMER, BOTH NET OF RETURNS
--
-- Same rule as migration 68, carried down to the item and to the
-- customer's own screen.
--
-- AT ITEM LEVEL THE DEDUCTION CANNOT ALWAYS BE PLACED. A credit note
-- of kind 'Credit Note' carries item rows and names the machine, so it
-- comes off that machine. A 'Credit Note (no stock)' carries no item
-- row at all -- 9 vouchers in REF, 74,548 rupees -- so there is nothing
-- to take it off. It is NOT quietly dropped and it is NOT spread about:
-- the screen adds the items up, compares the total against net sales,
-- and names the difference in words.
--
-- That is the check he asked to be standard on any report that splits a
-- total: sum the parts, compare against the whole, and say what is left
-- over rather than letting it vanish.
-- ============================================================

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
           (h.doc_type like 'Sales%') as is_sale,
           case when h.doc_type like 'Sales%'
                then row_number() over (partition by h.item
                       order by case when h.doc_type like 'Sales%' then h.vch_date end desc nulls last)
           end as rn
    from public.busy_history h
    where h.company = p_company and h.kind = 'item' and h.deleted_at is null
      and h.item is not null
      and (h.doc_type like 'Sales%' or h.doc_type like 'Credit%')
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
      select h.item, count(*) filter (where h.doc_type like 'Sales%') n,
             round(sum(case when h.doc_type like 'Sales%' then coalesce(h.amount,0)
                            else -coalesce(h.amount,0) end)) value
      from public.busy_history h
      where h.company = p_company and h.kind = 'item' and h.deleted_at is null
        and (h.doc_type like 'Sales%' or h.doc_type like 'Credit%')
        and h.party = p_customer and h.item is not null
      group by h.item
      order by sum(case when h.doc_type like 'Sales%' then coalesce(h.amount,0)
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
grant execute on function public.busy_items_sold(text) to authenticated;
