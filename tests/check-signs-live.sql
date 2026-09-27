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
--
-- AND IT HAS TO RUN AS A PERSON. busy_ledger and busy_balances ask
-- is_owner(), which reads auth.uid(), which reads the JWT claims -- and a
-- psql session has no signed-in person, so every call was refused with
-- "You do not have permission to see Busy data." This borrows the owner's
-- identity for the length of the session. It reads and never writes, and
-- it looks the owner up rather than carrying an id in a public repo.
-- ============================================================
select set_config('request.jwt.claims',
                  json_build_object('sub', ua.auth_user_id,
                                    'role', 'authenticated')::text, false)
from public.user_accounts ua
join public.party_roles pr on pr.party_id = ua.party_id
where ua.status = 'approved' and pr.role = 'owner' and pr.status = 'approved'
limit 1;

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

-- ============================================================
-- AND A BALANCE COMES FROM ITS OWN YEAR
--
-- "Ramson -- we have not done any business, still it shows 50,000."
--
-- The old rule took the latest opening AT OR BEFORE the date, which
-- reaches back through dead years until it finds one, and found March
-- 2016. RAMSONS TYRES has no 2026-27 opening and no 2026-27 movement, so
-- it reads NIL. JASPO WORLDWIDE and JOGA SINGH & CO. have a 2026-27
-- opening row and no movement, so they keep their balance: that is the
-- difference between the two, and it is the whole rule.
--
-- These three are sign-independent, so they hold before the reload too.
-- ============================================================
with want(ledger, closing) as (values
  ('RAMSONS TYRES',    0::numeric),
  ('JASPO WORLDWIDE',  200000::numeric),
  ('JOGA SINGH & CO.', 658745::numeric)
),
got as (
  select w.ledger, w.closing as expected,
         abs(round((public.busy_ledger('REF', w.ledger, date '2026-04-01',
                                       current_date) ->> 'closing')::numeric, 2)) as actual
  from want w
)
select case when actual = expected then 'PASS' else 'FAIL' end as result,
       ledger,
       to_char(expected, 'FM99,99,99,990') as expected,
       to_char(actual,   'FM99,99,99,990') as actual
from got order by ledger;

-- And the four totals, both sides, never netted. Compare against the
-- figures in docs/44 after the reload. ONE CALL PER STATEMENT: each takes
-- several seconds over 74,000 ledger rows, and asking for both in one
-- statement puts the pair past the 8 second budget the screen itself has.
select j->>'group' as list, j->>'fy' as fy,
       j->>'dr_count' as dr_parties, to_char((j->>'dr_total')::numeric, 'FM99,99,99,990') as dr_total,
       j->>'cr_count' as cr_parties, to_char((j->>'cr_total')::numeric, 'FM99,99,99,990') as cr_total,
       j->>'nil_count' as nil_parties
from (select public.busy_balances('REF', 'Sundry Debtors', date '2027-03-31') j) a;

select j->>'group' as list, j->>'fy' as fy,
       j->>'dr_count' as dr_parties, to_char((j->>'dr_total')::numeric, 'FM99,99,99,990') as dr_total,
       j->>'cr_count' as cr_parties, to_char((j->>'cr_total')::numeric, 'FM99,99,99,990') as cr_total,
       j->>'nil_count' as nil_parties
from (select public.busy_balances('REF', 'Sundry Creditors', date '2027-03-31') j) b;
