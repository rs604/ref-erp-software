# Two Akson ledgers

**Date:** 22 Sep 2026 · **Status:** live on main · **Migration 77**
`77_one_customer_two_ledgers_on_every_list`

---

## The reload is a pure sign flip, and all three checks already pass

With the two ledger names separated, every figure verifies against the data
**already loaded**, by negating it — which is what the flip does:

```
                                    live today      after the flip     wanted
AKSON INDUSTRIES PVT LTD  2026-27    997,050 Dr     9,97,050 Cr        ✓
AKSON INDUSTRIES          2026-27          0                 0         ✓
JUNEJA STEEL SALES        2026-27  1,554,211 Dr    15,54,211 Cr        ✓
```

So the loaded rows are the same rows, and only the sign is inverted — exactly
the 74,295 useless edits a plain reload would record. **Nothing is missing
from the current load**, which is the part I had wrong.

**The combined figure being the same was luck.** `AKSON INDUSTRIES` nets to
zero, so `AKSON` + `AKSON INDUSTRIES PVT LTD` happens to equal the second one
alone. Had the first carried any balance, matching on a pattern would have
given a wrong total and nothing would have said so.

### I cannot do the clear and the upload

Both are done from the Load history screen on the office PC: the Clear button
needs your confirmation, and `busy_rows_all_years.csv` and `busy_items.csv`
are on your machine, not here. If I cleared from this side the ERP would be
empty with no way for me to refill it. **Everything is ready for you to run
it**, in your order: clear · rows file · items file.

Then run this and every row must say PASS:

```
psql "$DATABASE_URL" -f tests/check-signs-live.sql
```

It checks the three balances **by exact ledger name** and prints the four
debtor and creditor totals beside them.

---

## Why your four totals came out lower than mine

Not the data — the data is identical. It is the grouping, and here is mine in
full so you can say which line to change:

1. **A party belongs to a group by its most recent row's `ledger_group`.**
   Busy can move a ledger between groups; the latest word wins.
2. **Balance** = the latest opening Busy gave at or before the date, plus
   every ledger row from that opening's FY start to the date. The same rule
   as the ledger screen, so the two screens cannot disagree.
3. **Included if the balance is not zero** — to the paisa.
4. **Parties with an opening balance and no movement in the range are
   included.** There are ten of them, and I think this is the line:

```
Debtors    JASPO WORLDWIDE 2,00,000 · B.S.W.BIKES 93,276
           POOJA INDUSTRIES PRIVATE LIMITED 1,71,560 · JATINDRA UDYOG PVT.LTD. 64,109
Creditors  JOGA SINGH & CO. 6,58,745 · RAJBIR ERECTOR & FABRICATOR 3,99,779
           HAR MOHINDRA ENGINEERING WORKS 1,09,786 · G.K.MACHINE TOOLS 30,000
           ASK THE WISE GUY 600 · K.P.S.PUBLICATIONS 432
```

They are on the screen with **"none"** under *Last transaction*, so they can
be seen rather than guessed at. The date makes no difference — there are no
vouchers after July 2026, so "today" and "end of FY" give the same answer.

If your list drops parties with no movement, say so and it is one line.

---

## The flag, on every list now

The rule is **widened by exactly one thing**: the words that say what kind of
company it is — PVT · PRIVATE · LTD · LIMITED · CO · COMPANY · CORP ·
CORPORATION · INC · LLP · AND.

Measured on the real data before it was written: **20 groups across both
firms, every one a genuine pair**, and five the old rule missed:

```
AKSON INDUSTRIES                  AKSON INDUSTRIES PVT LTD
ARK ENGINEERING PRIVATE LIMITED   ARK ENGINEERING PVT LTD.
FAIRDEAL AGENCIES                 FAIRDEAL AGENCIES PVT LTD.
GOEL SALES CORP.                  GOEL SALES CORPORATION
POOJA INDUSTRIES PRIVATE LIMITED  POOJA INDUSTRIES PVT.LTD
RALSON ( INDIA ) LIMITED. · RALSON (INDIA) LIMITED · RALSON INDIA PVT. LIMITED
```

It still does **not** join HERO MOTORS LIMITED to HERO MOTORS LIMITED
(DADRI) — DADRI is a place, not a company form. That line is the whole reason
the flag stays worth reading.

**Two things the trial run caught**, both the rule eating letters that carry
meaning: `S` as a stop word turned R S INDUSTRIES into `R INDUSTRIE`, and
stripping a trailing S turned UNICROSS into `UNICROS`. Initials are not
company forms, and a word ending SS is not a plural.

On the customer list, debtors and creditors: an amber **2 ledgers** marker on
the row, naming the others in its tooltip, and a line above the rows —
*"1 of these has another ledger with nearly the same name."* One call per
screen, not one per row. **Nothing is merged, anywhere.**

---

## The check names the exact ledger

```
an advance received is a CREDIT, not a debit — the side, not the amount
and its amount is right too, which is all the old check asked
the row checked is AKSON INDUSTRIES PVT LTD exactly, not whatever matched "AKSON"
a party with a second ledger of nearly the same name is marked on the row
BOTH Akson rows on the customer list are marked, not just one
the mark names the other ledger, so the row carries the whole answer
a customer with one ledger is not marked — the flag is not on everything
```

The row is found by `data-balparty` equality, never by a prefix.

---

## Tests

```
admin-permissions  28/28     nav       64/64
busy              262/262    phone    162/162
cold-open         108/108    sweep     60/60
check-live: 12 shipped files · what main serves is what is in the repo
```

Migration 77 md5 `a3c01f523a96186c18f99e1b00221b32`, verified against the
database's own fingerprint.

---

## Still open

- **The clear and the two uploads** — yours, then `tests/check-signs-live.sql`.
- **The ten opening-only parties**, above: in or out?
- **The 12px floor at a desk** — phone rule only, or everywhere?
