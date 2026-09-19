-- ============================================================
-- 64 THE REPORTS SCREEN COUNTS EVERY VOUCHER
--
-- busy_monthly_totals told one voucher from the next with
-- fy + vch_type + vch_no. Doc 19 retired that key in migration 41 and
-- said why: vch_no is the number people say out loud, it repeats, and
-- two bills numbered 167 are two bills. The rule there is
-- company + fy + vch_code + sr_no, and this function never got it.
--
-- What it cost, measured before the change:
--
--     REF   10,677 vouchers exist.  10,332 were counted.  345 dropped.
--           Turnover  67.64 crore true, 66.26 crore shown  -- 1.38 crore
--           GST        8.64 crore true,  8.48 crore shown  --   15.9 lakh
--     RS       859 vouchers exist.     858 were counted.    1 dropped.
--
-- A dropped voucher is not a rounding difference. It is a whole bill,
-- with its tax, missing from a turnover figure -- and nothing on the
-- screen said a number was being thrown away. Same fault as the
-- counters that read zero on a full table: the silence, not the sum.
--
-- distinct on (company, fy, vch_code) is the fix. company is already
-- fixed by the argument, and is in the key for the avoidance of doubt.
-- sr_no is deliberately NOT in it: the voucher total and the voucher
-- tax belong to the voucher, and taking one line per voucher is the
-- whole point of this half of the query.
-- ============================================================

create or replace function public.busy_monthly_totals(p_company text)
returns table(fy text, month_start date, doc_type text, line_amount numeric,
              voucher_total numeric, voucher_tax numeric,
              voucher_count integer, line_count integer)
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
      select distinct on (h.company, h.fy, h.vch_code)
             h.fy,
             date_trunc('month', h.vch_date)::date as month_start,
             h.doc_type,
             coalesce(h.vch_total,0) as vch_total,
             coalesce(h.cgst,0) + coalesce(h.sgst,0) + coalesce(h.igst,0) as tax
      from public.busy_history h
      where h.company = p_company and h.kind = 'item'
        and h.vch_date is not null and h.deleted_at is null
      order by h.company, h.fy, h.vch_code, h.vch_date
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
$function$;
