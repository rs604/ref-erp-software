-- ============================================================
-- 34 MONTHLY TOTALS FOR THE REPORTS
--
-- THE TRAP THIS FUNCTION EXISTS TO AVOID:
-- cgst, sgst, igst and vch_total belong to the VOUCHER, and the parser
-- copies them onto every item line of that voucher. An invoice with six
-- lines carries its GST six times. Summing them per row would report six
-- times the real tax and six times the real turnover.
--
-- So: amount is per line and is summed directly. Tax and voucher total
-- are counted ONCE per voucher, then summed.
-- ============================================================

create or replace function public.busy_monthly_totals(p_company text)
returns table (
  fy text,
  month_start date,
  doc_type text,
  line_amount numeric,
  voucher_total numeric,
  voucher_tax numeric,
  voucher_count int,
  line_count int
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
    where h.company = p_company and h.vch_date is not null
    group by 1,2,3
  ),
  -- one row per voucher, so the tax is not counted once per item line
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
      where h.company = p_company and h.vch_date is not null
      order by h.fy, h.vch_type, h.vch_no, h.vch_date
    ) v
    group by 1,2,3
  )
  select l.fy, l.month_start, l.doc_type,
         l.line_amount,
         coalesce(vc.voucher_total, 0),
         coalesce(vc.voucher_tax, 0),
         coalesce(vc.voucher_count, 0),
         l.line_count
  from lines l
  left join vouchers vc
    on vc.fy = l.fy and vc.month_start = l.month_start and vc.doc_type = l.doc_type
  order by l.month_start, l.doc_type;
end;
$$;

comment on function public.busy_monthly_totals(text) is
  'Month by month totals for one firm. Line amounts are summed per line; GST and voucher totals are counted ONCE PER VOUCHER, because the parser repeats them on every item line and summing them per row would report several times the real tax.';

revoke all on function public.busy_monthly_totals(text) from public, anon;
grant execute on function public.busy_monthly_totals(text) to authenticated;
