-- ============================================================
-- 36 A DELETED ROW LEAVES THE EVERYDAY SCREENS
--
-- Marked deleted means gone from price history, challans and reports.
-- It stays in the table for good, and the owner-only screen still shows
-- it. Without this, a deleted invoice would keep setting the price.
-- ============================================================

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
    where h.company = p_company and h.vch_date is not null and h.deleted_at is null
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
      where h.company = p_company and h.vch_date is not null and h.deleted_at is null
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
