-- ============================================================
-- THE SIDE, ON THE REAL DATA, BY EXACT LEDGER NAME
--
-- Run this against the project after a reload. Every row must say PASS.
--
--   psql "$DATABASE_URL" -f tests/check-signs-live.sql
--
-- WHY IT EXISTS. In Busy a positive Value1 is a CREDIT. The parser read
-- it the other way round until 2026.09.21-mdbtools, so every Dr on the
-- ledger screen was a Cr and PAYABLE and RECEIVABLE were swapped. The
-- check that was supposed to catch that compared the AMOUNT and never
-- the side: Hindon's 41,250 was right and its Dr was wrong.
--
-- BY EXACT NAME, NEVER A PATTERN. There are two Akson ledgers:
--   AKSON INDUSTRIES          nets to zero
--   AKSON INDUSTRIES PVT LTD  holds the 9,97,050 advance
-- A check matching "AKSON" would pass or fail on whichever it found
-- first, and the two happen to add up to the same figure. That is luck,
-- not method.
-- ============================================================
with want(company, ledger, fy_from, fy_to, amount, side) as (values
  ('REF', 'AKSON INDUSTRIES PVT LTD', date '2026-04-01', date '2027-03-31',  997050::numeric, 'Cr'),
  ('REF', 'AKSON INDUSTRIES',         date '2026-04-01', date '2027-03-31',       0::numeric, '--'),
  ('REF', 'JUNEJA STEEL SALES',       date '2026-04-01', date '2027-03-31', 1554211::numeric, 'Cr')
),
got as (
  select w.*,
         (public.busy_ledger(w.company, w.ledger, w.fy_from, w.fy_to) ->> 'closing')::numeric as closing
  from want w
)
select
  case when round(abs(closing), 2) = amount
        and case when abs(closing) < 0.005 then '--'
                 when closing > 0 then 'Dr' else 'Cr' end = side
       then 'PASS' else 'FAIL' end                                as result,
  ledger,
  to_char(amount, 'FM99,99,99,990') || ' ' || side                as expected,
  to_char(abs(round(closing, 2)), 'FM99,99,99,990') || ' ' ||
    case when abs(closing) < 0.005 then '--'
         when closing > 0 then 'Dr' else 'Cr' end                 as actual
from got
order by ledger;

-- And the four totals, both sides, never netted. Compare against the
-- figures in docs/43 after the reload.
select j->>'group' as list,
       j->>'dr_count' as dr_parties, to_char((j->>'dr_total')::numeric, 'FM99,99,99,990') as dr_total,
       j->>'cr_count' as cr_parties, to_char((j->>'cr_total')::numeric, 'FM99,99,99,990') as cr_total
from (select public.busy_balances('REF', 'Sundry Debtors',   date '2027-03-31') j) a
union all
select j->>'group', j->>'dr_count', to_char((j->>'dr_total')::numeric, 'FM99,99,99,990'),
       j->>'cr_count', to_char((j->>'cr_total')::numeric, 'FM99,99,99,990')
from (select public.busy_balances('REF', 'Sundry Creditors', date '2027-03-31') j) b;
