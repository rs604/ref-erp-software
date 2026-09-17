# Busy Data — ledger rows, GST paid, and a key that does not work

**Date:** 17 Sep 2026 · **Status:** applied to Mumbai, pushed
**Migrations 39–40 · `busy.html` GST screen rebuilt**

---

## STOP HERE FIRST — the import key cannot tell one voucher from another

**The history cannot be loaded until the parser sends Busy's `VchCode`.**

Rows are identified by `company + fy + vch_type + vch_no + sr_no`. Checked
against the 200 rows of the new sample:

| | Rows | Distinct keys | Would be lost |
|---|---|---|---|
| Ledger rows | 80 | **4** | **76 — 95%** |
| Item rows | 120 | 119 | 1 |
| **Total** | **200** | **123** | **77** |

**Two separate causes, both real:**

- **Every ledger row has a blank voucher number.** All 80 of them, no exceptions.
  So all 38 payments in the sample share the key `(19, '', 1)` — 37 would
  overwrite each other and the last one loaded would win
- **Voucher numbers repeat among item rows too.** Purchase bill **167** is two
  genuinely different bills: ORIGINATIV SOLUTIONS on 24 Jun for ₹19,365, and
  B.R.TOOLS on 29 Jun for ₹56,000. Different party, different date, different
  amount, same number

**This has been wrong since migration 27.** The ledger rows did not cause it,
they just made it impossible to miss. Item rows would already have been quietly
overwriting each other in the 22,732-row load.

**The fix is one column: `VchCode` from `Tran1`.** It is Busy's own identity for
a voucher. The key then becomes `company + fy + vch_code + sr_no` and everything
else stands. That is your parser, so I have not touched it.

**What I did instead:** the import now **counts the rows and counts the keys, and
refuses the whole file if they differ**, naming an example. Nothing is loaded.
Losing three quarters of the payments silently is far worse than a refusal that
says why.

**Tested:** two real payment vouchers with blank numbers were offered to the
import. It refused, loaded nothing, and said *"This file holds 2 rows but only 1
of them can be told apart, so 1 would be silently overwritten."*

---

## What else was built

**The five new columns** — `kind`, `ledger`, `ledger_group`, `debit`, `credit`.
Plus indexes on kind and on the ledger name.

**`is_lump_sum` now comes from the parser, and it had to.** It was a generated
column: quantity 0 and amount not 0. **Every ledger row fits that** — all 80 in
the sample have an amount and no quantity — so every payment posting would have
been labelled a lump-sum machine sale. Not merely redundant, wrong. Dropped and
replaced with the parser's value.

**Ledger rows can never reach price history.** `busy_search`,
`busy_item_rate_stats` and `busy_monthly_totals` are all scoped to
`kind = 'item'`. Tested: a file of 2 item rows and 4 ledger rows shows exactly 2
rows in price history.

---

## GST — the real figures

`busy_gst_ledger(company)` returns one row per voucher touching the GST control
ledger, matched **by name** from a setting (`gst_ledger_prefix`, default
`GST PAYABLE`) because the code differs in every company file.

- **Type 19 is a payment.** The GST ledger is debited, and that debit is money
  that actually left the bank
- **Type 16 is the monthly journal** computing the liability
- **The double-count trap was handled again:** a journal with six postings carries
  `vch_total` six times, so `vch_total` is **never used here**. The amount is the
  posting on the GST ledger itself

**Tested** with vouchers built to match two of your eleven: ₹2,05,299 on 19 May
2025 and ₹13,212 on 20 Jun 2025. The function returned **₹2,18,511** — exactly
those two — and correctly left out the bank side of the same voucher.

**RS Industries returns nothing, and that is not an error.** The screen says so
in plain words rather than looking broken.

**The screen now shows** actually paid, computed in the journals, and the gap
between them, with every voucher listed underneath. The old invoice-derived
estimate is still there, in its own card, still labelled an estimate and still
never called payable.

---

## The eleven payments, for checking after the load

These are the acceptance test. After the history is loaded, REF should show
exactly these under "actually paid":

| FY | Date | Amount |
|---|---|---|
| 2018-19 | 19 Apr 2018 | ₹20,914 |
| 2024-25 | 19 Dec 2024 | ₹2,02,419 |
| 2024-25 | 20 Jan 2025 | ₹4,34,171 |
| 2025-26 | 19 May 2025 | ₹2,05,299 |
| 2025-26 | 20 Jun 2025 | ₹13,212 |
| 2025-26 | 18 Jul 2025 | ₹35,169 |
| 2025-26 | 19 Nov 2025 | ₹75,528 |
| 2025-26 | 19 Dec 2025 | ₹1,60,046 |
| 2025-26 | 20 Jan 2026 | ₹36,286 |
| 2026-27 | 18 Jul 2026 | ₹5,23,590 |
| 2026-27 | 19 Aug 2026 | ₹1,05,563 |

Plus 179 monthly computations on type 16. If the count or the total differs,
something is wrong and the load should stop.

---

## What is needed from you

1. **`VchCode` in the parser output.** Nothing can be loaded until then — the
   import will refuse, by design
2. Once it arrives, the key changes to `company + fy + vch_code + sr_no`. That is
   a small migration and the rest stands

## Still waiting on a Windows machine and the real files

- The uploader `.exe`, the setup screen, the download screen
- The one-time load of 22,732 item rows and 24,903 ledger rows
