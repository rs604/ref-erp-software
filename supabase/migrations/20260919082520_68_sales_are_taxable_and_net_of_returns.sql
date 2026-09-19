-- ============================================================
-- 68 SALES ARE TAXABLE VALUE, AND NET OF RETURNS
--
-- Every sales figure I shipped was wrong, in the flattering direction,
-- and he caught it against a number he already knew.
--
-- FAULT 1 -- GST-INCLUSIVE. A business owner thinks in TAXABLE VALUE.
-- 2026-27 read 2.39 crore because it carried the tax. It is 2.02 crore
-- before returns. GST is shown separately or not at all.
--
-- FAULT 2 -- RETURNS WERE NEVER SUBTRACTED. Ten credit notes in 2026-27
-- alone, 21.6 lakh of them, including 11 lakh back from Gursewak Singh
-- Nijjar and 3.85 lakh from Yanmar. A sales figure that ignores returns
-- is wrong, and always wrong the flattering way.
--
--     NET SALES     = sales invoices  - credit notes
--     NET PURCHASES = purchase bills  - debit notes
--
-- THE ONE RULE FOR TAXABLE VALUE. A voucher balances, so its lines fall
-- into exactly three heaps: the party side (Sundry Debtors or Sundry
-- Creditors), the tax (Duties & Taxes), and everything else. The third
-- heap IS the taxable value. Checked, not assumed -- on all four
-- document types the three heaps sum to exactly zero, and reading the
-- value off the party side or off the third heap gives the same rupee.
--
-- Round-off is excluded. It belongs to the invoice, not to the sale,
-- and leaving it in put this year 6 rupees over his figure.
--
-- PROVED, REF 2026-27:
--     gross 20,244,255 - credit notes 2,163,948 = net 18,080,307
-- which is his 1.8 crore, to the rupee, all three figures.
--
-- WHY NOT "CREDIT NOTE ITEM ROWS ONLY", WHICH IS WHAT HE ASKED FOR.
-- It gives the identical answer -- on every ordinary credit note the two
-- routes agree to the rupee, and on his proof year exactly. But a
-- "Credit Note (no stock)" HAS NO ITEM ROWS AT ALL: 9 such vouchers in
-- REF, 74,548 rupees, which an item-only rule drops in silence. This
-- rule catches them, and it is the same rule sales already uses rather
-- than a second one.
--
-- He is right that the ledger rows must not be summed whole: 38 ledger
-- rows carrying 51 lakh against 10 item rows carrying 21.6 lakh. Those
-- 38 are both sides of the same vouchers. Taking only the third heap is
-- what stops it being counted twice.
-- ============================================================

-- The rule, written once. Everything below asks this and nothing
-- re-states it, so there is one place to correct if it is ever wrong.
create or replace function public.busy_is_value_line(p_group text, p_ledger text)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_group, '')  not ilike '%Debtor%'
     and coalesce(p_group, '')  not ilike '%Creditor%'
     and coalesce(p_group, '')  not ilike 'Duties%'
     and coalesce(p_ledger, '') not ilike 'Round%';
$function$;

create or replace function public.busy_is_tax_line(p_group text)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_group, '') ilike 'Duties%';
$function$;


-- ---------- one row per voucher, with its taxable value ----------
-- doc_kind folds the "(no stock)" variants in with their parents, so a
-- report never has to list four spellings of the same thing.
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
         case when min(h.doc_type) like 'Sales%'    then 'sale'
              when min(h.doc_type) like 'Credit%'   then 'credit_note'
              when min(h.doc_type) like 'Purchase B%' or min(h.doc_type) like 'Purchase (%'
                                                     then 'purchase'
              when min(h.doc_type) like 'Debit%'    then 'debit_note'
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
    and (h.doc_type like 'Sales%' or h.doc_type like 'Credit%'
      or h.doc_type like 'Purchase B%' or h.doc_type like 'Purchase (%'
      or h.doc_type like 'Debit%')
  group by h.fy, h.vch_code;
end;
$function$;


-- ---------- month by month, three figures each side ----------
drop function if exists public.busy_monthly_totals(text);

create function public.busy_monthly_totals(p_company text)
returns table(fy text, month_start date,
              gross_sales numeric, credit_notes numeric, net_sales numeric,
              gross_purchases numeric, debit_notes numeric, net_purchases numeric,
              output_tax numeric, input_tax numeric,
              sale_vouchers integer, purchase_vouchers integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  return query
  select v.fy, date_trunc('month', v.vch_date)::date,
         coalesce(sum(v.taxable) filter (where v.doc_kind = 'sale'), 0),
         coalesce(sum(v.taxable) filter (where v.doc_kind = 'credit_note'), 0),
         coalesce(sum(v.taxable) filter (where v.doc_kind = 'sale'), 0)
           - coalesce(sum(v.taxable) filter (where v.doc_kind = 'credit_note'), 0),
         coalesce(sum(v.taxable) filter (where v.doc_kind = 'purchase'), 0),
         coalesce(sum(v.taxable) filter (where v.doc_kind = 'debit_note'), 0),
         coalesce(sum(v.taxable) filter (where v.doc_kind = 'purchase'), 0)
           - coalesce(sum(v.taxable) filter (where v.doc_kind = 'debit_note'), 0),
         coalesce(sum(v.tax) filter (where v.doc_kind = 'sale'), 0),
         coalesce(sum(v.tax) filter (where v.doc_kind = 'purchase'), 0),
         count(*) filter (where v.doc_kind = 'sale')::int,
         count(*) filter (where v.doc_kind = 'purchase')::int
  from public.busy_vouchers(p_company) v
  group by v.fy, date_trunc('month', v.vch_date)::date
  order by 2;
end;
$function$;


-- ---------- REPORT 1: customers, net of what came back ----------
drop function if exists public.busy_customer_list(text);

create function public.busy_customer_list(p_company text)
returns table(customer text,
              this_fy numeric, last_fy numeric, change_pct numeric,
              lifetime_gross numeric, lifetime_credit_notes numeric, lifetime numeric,
              invoices bigint, credit_note_count bigint,
              last_sale date, quiet_days integer)
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
  return query
  with v as (
    select * from public.busy_vouchers(p_company)
    where doc_kind in ('sale','credit_note') and counterparty is not null
  ),
  signed as (
    select counterparty as cust, fy, vch_date, doc_kind,
           case when doc_kind = 'sale' then taxable else -taxable end as net
    from v
  )
  select s.cust,
         coalesce(sum(s.net) filter (where s.fy = v_this), 0),
         coalesce(sum(s.net) filter (where s.fy = v_last), 0),
         case when coalesce(sum(s.net) filter (where s.fy = v_last), 0) <> 0
              then round((coalesce(sum(s.net) filter (where s.fy = v_this), 0)
                        - coalesce(sum(s.net) filter (where s.fy = v_last), 0))
                        / abs(sum(s.net) filter (where s.fy = v_last)) * 100, 1)
         end,
         coalesce(sum(s.net) filter (where s.doc_kind = 'sale'), 0),
         coalesce(-sum(s.net) filter (where s.doc_kind = 'credit_note'), 0),
         coalesce(sum(s.net), 0),
         count(*) filter (where s.doc_kind = 'sale'),
         count(*) filter (where s.doc_kind = 'credit_note'),
         max(s.vch_date) filter (where s.doc_kind = 'sale'),
         (current_date - max(s.vch_date) filter (where s.doc_kind = 'sale'))::int
  from signed s
  group by s.cust
  having count(*) filter (where s.doc_kind = 'sale') > 0
  order by coalesce(sum(s.net), 0) desc;
end;
$function$;

revoke all on function public.busy_vouchers(text) from public;
revoke all on function public.busy_monthly_totals(text) from public;
revoke all on function public.busy_customer_list(text) from public;
grant execute on function public.busy_vouchers(text) to authenticated;
grant execute on function public.busy_monthly_totals(text) to authenticated;
grant execute on function public.busy_customer_list(text) to authenticated;
