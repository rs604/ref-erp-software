-- ============================================================
-- 66 THE CUSTOMER REPORTS
--
-- WHAT A SALE IS WORTH. The customer's own ledger line carries the
-- invoice INCLUDING GST. The Sale line of the same voucher carries it
-- without. Turnover is the one without, and it is the one that
-- reproduces his own figures: Spur's last year comes to 490,936 net,
-- against 579,305 gross, and he knows it as 4.9 lakh. Atlas lifetime is
-- 1.58 crore net, which he knows as 1.6 crore. So: net of GST, and the
-- screen says "excluding GST" so nobody wonders which it is.
--
-- ONE VOUCHER IS (company, fy, vch_code). Not vch_code, which repeats
-- across years -- code 119 is Atlas in 2019-20, Kohinoor in 2020-21 and
-- Dhanoa in 2024-25. Grouping on it alone puts other customers' money
-- into Atlas's row, and it looks entirely plausible while doing it.
-- Doc 19 settled this key; migration 64 fixed the last function that
-- had not been told.
--
-- 159 QUIET OF 255 IS THE TWO FIRMS ADDED TOGETHER. REF has 228
-- customers, 139 of them quiet for over a year; RS has 27 and 17. The
-- totals only reach 255 and 156 if you put the two companies in one
-- list, which is the one thing every screen here is built not to do.
-- Each firm is counted on its own and says which firm it is counting.
-- ============================================================

create or replace function public.busy_fy_of(p_d date)
returns text
language sql
immutable
as $function$
  select case when p_d is null then null else
    to_char(case when extract(month from p_d) >= 4
                 then extract(year from p_d) else extract(year from p_d) - 1 end, 'FM0000')
    || '-' ||
    to_char(mod((case when extract(month from p_d) >= 4
                 then extract(year from p_d) + 1 else extract(year from p_d) end)::int, 100), 'FM00')
  end;
$function$;


-- ---------- REPORT 1: the customer list ----------
create or replace function public.busy_customer_list(p_company text)
returns table(customer text, this_fy numeric, last_fy numeric, change_pct numeric,
              lifetime numeric, invoices bigint, last_sale date, quiet_days integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_this text := public.busy_fy_of(current_date);
  v_last text := public.busy_fy_of((current_date - interval '1 year')::date);
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
  with v as (
    select h.fy, h.vch_code,
           max(h.vch_date) as d,
           max(h.ledger) filter (where h.ledger_group ilike '%Debtor%') as cust,
           sum(coalesce(h.debit,0) - coalesce(h.credit,0))
             filter (where h.ledger_group ilike 'Sale%') as net
    from public.busy_history h
    where h.company = p_company and h.kind = 'ledger' and h.deleted_at is null
      and h.doc_type = 'Sales Invoice'
    group by h.fy, h.vch_code
  )
  select v.cust,
         coalesce(sum(v.net) filter (where v.fy = v_this), 0),
         coalesce(sum(v.net) filter (where v.fy = v_last), 0),
         case when coalesce(sum(v.net) filter (where v.fy = v_last), 0) <> 0
              then round((coalesce(sum(v.net) filter (where v.fy = v_this), 0)
                        - coalesce(sum(v.net) filter (where v.fy = v_last), 0))
                        / abs(sum(v.net) filter (where v.fy = v_last)) * 100, 1)
         end,
         coalesce(sum(v.net), 0),
         count(*),
         max(v.d),
         (current_date - max(v.d))::int
  from v
  where v.cust is not null
  group by v.cust
  order by coalesce(sum(v.net), 0) desc;
end;
$function$;


-- ---------- one customer's own screen ----------
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
    select h.fy, h.vch_code,
           max(h.vch_date) as d,
           max(h.vch_no) filter (where h.ledger_group ilike '%Debtor%') as vch_no,
           max(h.ledger) filter (where h.ledger_group ilike '%Debtor%') as cust,
           sum(coalesce(h.debit,0) - coalesce(h.credit,0))
             filter (where h.ledger_group ilike 'Sale%') as net,
           sum(coalesce(h.credit,0) - coalesce(h.debit,0))
             filter (where h.ledger_group ilike '%Debtor%') as gross
    from public.busy_history h
    where h.company = p_company and h.kind = 'ledger' and h.deleted_at is null
      and h.doc_type = 'Sales Invoice'
    group by h.fy, h.vch_code
  ),
  mine as (select * from v where cust = p_customer),
  years as (
    select jsonb_agg(jsonb_build_object('fy', fy, 'value', value, 'invoices', n)
                     order by fy) y
    from (select fy, round(sum(net)) value, count(*) n from mine group by fy) a
  ),
  invs as (
    select jsonb_agg(jsonb_build_object('date', d, 'vch_no', vch_no,
                                        'net', round(net), 'gross', round(gross))
                     order by d desc) i
    from (select * from mine order by d desc limit 200) b
  ),
  items as (
    select jsonb_agg(jsonb_build_object('item', item, 'times', n, 'value', value)
                     order by value desc) t
    from (
      select h.item, count(*) n, round(sum(coalesce(h.amount,0))) value
      from public.busy_history h
      where h.company = p_company and h.kind = 'item' and h.deleted_at is null
        and h.doc_type = 'Sales Invoice' and h.party = p_customer
        and h.item is not null
      group by h.item order by sum(coalesce(h.amount,0)) desc limit 10
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


-- ---------- REPORT 2: items sold ----------
-- No lowest-to-highest rate column, deliberately. An Inclined Slat
-- Conveyor runs 1,55,000 to 12,00,000 because the machine type is the
-- item and the size lives in the description. A min-max column would
-- read as a pricing problem where there is none.
create or replace function public.busy_items_sold(p_company text)
returns table(item text, times_sold bigint, total_value numeric,
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
  with s as (
    select h.item, h.party, h.vch_date, h.rate, h.amount,
           row_number() over (partition by h.item order by h.vch_date desc) as rn
    from public.busy_history h
    where h.company = p_company and h.kind = 'item' and h.deleted_at is null
      and h.doc_type = 'Sales Invoice' and h.item is not null
  )
  select s.item, count(*), coalesce(sum(s.amount), 0),
         max(s.party) filter (where s.rn = 1),
         max(s.vch_date),
         max(s.rate)  filter (where s.rn = 1)
  from s group by s.item
  order by coalesce(sum(s.amount), 0) desc;
end;
$function$;


create or replace function public.busy_item_sales(p_company text, p_item text)
returns table(vch_date date, party text, vch_no text, description text,
              qty numeric, rate numeric, amount numeric, is_lump_sum boolean)
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
         h.qty, h.rate, h.amount, coalesce(h.is_lump_sum, false)
  from public.busy_history h
  where h.company = p_company and h.kind = 'item' and h.deleted_at is null
    and h.doc_type = 'Sales Invoice' and h.item = p_item
  order by h.vch_date desc
  limit 500;
end;
$function$;
