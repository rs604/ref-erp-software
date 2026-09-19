-- ============================================================
-- 67 MATERIAL PRICES, THEN AND NOW
--
-- WHICH AVERAGE. The brief says simple average, stated as such. Measured
-- on the real rows, the simple average of the rate is not a price -- it
-- is whatever the oddest line in the month was:
--
--     PIPE, Sep 2026, 10 purchases
--       simple average of rate   213.54      <- one line at 798
--       median rate               73.10
--       spent / quantity          65.11
--     PIPE, May 2026   simple 60.67   weighted 65.20   (a line at 8.00)
--
-- The item is "PIPE" and the size is in the description, so one row can
-- be a rate per kilo and the next a rate per length. Averaging them
-- treats those as the same number. Spent divided by quantity cannot be
-- thrown by one small odd line, and it is literally what the steel cost.
--
-- So BOTH are returned and the screen shows both, headed by the
-- weighted one and naming the method in one line -- which is the
-- "stated as such" the brief asks for. Switching the headline to the
-- simple average is one word in the screen if he wants it.
--
-- A MONTH NEEDS THREE PURCHASES to be a month. Fewer than that is one
-- invoice wearing a month's name. This is his own threshold -- the 98
-- months he verified are the months with three or more.
--
-- AND IT NEVER SUBSTITUTES A MONTH IN SILENCE. If the month asked for
-- has no steel in it, the nearest one is used AND NAMED, so the screen
-- can say "No steel purchases in Jan 2024 -- nearest is Dec 2023"
-- rather than showing December's price under January's heading.
-- ============================================================

create or replace function public.busy_material_prices(
  p_company        text,
  p_on             date    default current_date,
  p_months_before  integer default 2)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_target date;
  v_out    jsonb;
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;
  if p_months_before is null or p_months_before < 0 or p_months_before > 240 then
    raise exception 'Months before must be between 0 and 240.'
      using errcode = 'check_violation';
  end if;

  v_target := date_trunc('month',
                coalesce(p_on, current_date) - (p_months_before || ' months')::interval)::date;

  with priced as (
    select case when h.item ilike '%PIPE%'    then 'Pipe'
                when h.item ilike '%ANGLE%'   then 'Angle'
                when h.item ilike '%CHANNEL%' then 'Channel'
                when h.item ilike '%SHEET%' or h.item ilike '%PLATE%' then 'Sheet'
           end as material,
           date_trunc('month', h.vch_date)::date as mm,
           h.qty, h.rate, h.amount
    from public.busy_history h
    where h.company = p_company and h.kind = 'item' and h.deleted_at is null
      and h.doc_type = 'Purchase Bill'
      and h.vch_date is not null
      and h.rate is not null and h.rate > 0
      and h.qty  is not null and h.qty  > 0
      and coalesce(h.is_lump_sum, false) = false
  ),
  months as (
    select material, mm, count(*)::int as buys,
           round(sum(amount) / nullif(sum(qty), 0), 2) as weighted,
           round(avg(rate), 2)                         as simple
    from priced
    where material is not null
    group by material, mm
    having count(*) >= 3
  ),
  picked as (
    select m.material,
           -- the month asked for, or the nearest month that has steel in it
           (select row_to_json(t) from (
              select mm, buys, weighted, simple from months x
              where x.material = m.material
              order by abs(x.mm - v_target), x.mm desc limit 1) t) as then_j,
           (select row_to_json(t) from (
              select mm, buys, weighted, simple from months x
              where x.material = m.material
              order by x.mm desc limit 1) t) as now_j
    from (select distinct material from months) m
  )
  select jsonb_build_object(
    'company',       p_company,
    'on',            p_on,
    'months_before', p_months_before,
    'asked_month',   v_target,
    'min_buys',      3,
    'materials',     coalesce(jsonb_agg(
       jsonb_build_object(
         'material',      p.material,
         'then_month',    (p.then_j->>'mm')::date,
         'then_buys',     (p.then_j->>'buys')::int,
         'then_weighted', (p.then_j->>'weighted')::numeric,
         'then_simple',   (p.then_j->>'simple')::numeric,
         'then_is_nearest', ((p.then_j->>'mm')::date is distinct from v_target),
         'now_month',     (p.now_j->>'mm')::date,
         'now_buys',      (p.now_j->>'buys')::int,
         'now_weighted',  (p.now_j->>'weighted')::numeric,
         'now_simple',    (p.now_j->>'simple')::numeric,
         'change_weighted', case when (p.then_j->>'weighted')::numeric > 0
              then round(((p.now_j->>'weighted')::numeric - (p.then_j->>'weighted')::numeric)
                         / (p.then_j->>'weighted')::numeric * 100, 1) end,
         'change_simple',   case when (p.then_j->>'simple')::numeric > 0
              then round(((p.now_j->>'simple')::numeric - (p.then_j->>'simple')::numeric)
                         / (p.then_j->>'simple')::numeric * 100, 1) end)
       order by p.material), '[]'::jsonb))
  into v_out
  from picked p;

  return v_out;
end;
$function$;


-- What this machine was charged at before. Its own row per sale, never
-- averaged: the size is in the description, so two sales of the same
-- item name are not the same machine and an average of them is a number
-- about nothing.
create or replace function public.busy_item_price_history(p_company text, p_item text)
returns table(vch_date date, party text, description text,
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

  return query
  select h.vch_date, h.party, h.description, h.qty, h.rate, h.amount,
         coalesce(h.is_lump_sum,false)
  from public.busy_history h
  where h.company = p_company and h.kind = 'item' and h.deleted_at is null
    and h.doc_type = 'Sales Invoice' and h.item = p_item
  order by h.vch_date asc
  limit 200;
end;
$function$;

revoke all on function public.busy_customer_list(text) from public;
revoke all on function public.busy_customer_detail(text, text) from public;
revoke all on function public.busy_items_sold(text) from public;
revoke all on function public.busy_item_sales(text, text) from public;
revoke all on function public.busy_material_prices(text, date, integer) from public;
revoke all on function public.busy_item_price_history(text, text) from public;
grant execute on function public.busy_customer_list(text) to authenticated;
grant execute on function public.busy_customer_detail(text, text) to authenticated;
grant execute on function public.busy_items_sold(text) to authenticated;
grant execute on function public.busy_item_sales(text, text) to authenticated;
grant execute on function public.busy_material_prices(text, date, integer) to authenticated;
grant execute on function public.busy_item_price_history(text, text) to authenticated;
