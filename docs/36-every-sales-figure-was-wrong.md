# Every sales figure was wrong

**Date:** 19 Sep 2026 · **Status:** live on main · Migrations 68–70

He checked 2026-27 against a number he already knew. The screen said
**₹2.39 crore**. The truth is **₹1.8 crore**. Two faults, both mine.

---

## Fault 1 — the figure carried GST

A business owner thinks in **taxable value**, and so does every report he has
ever read. ₹2,38,87,252 is ₹2,02,44,255 with the tax on top. GST is shown
separately or not at all.

## Fault 2 — returns were never subtracted

Ten credit notes in 2026-27 alone, **₹21.6 lakh**, including ₹11 lakh back
from Gursewak Singh Nijjar and ₹3.85 lakh from Yanmar.

```
NET SALES     = sales invoices  −  credit notes
NET PURCHASES = purchase bills  −  debit notes
```

A sales figure that ignores returns is wrong, and always wrong the flattering
way. That is the worse direction to be wrong in.

**Proved, REF 2026-27:** 20,244,255 − 2,163,948 = **18,080,307**. His three
figures, to the rupee, out of the live function.

---

## One rule for taxable value, and it checks itself

A voucher balances, so its lines fall into exactly three heaps: the **party
side** (Sundry Debtors or Creditors), the **tax** (Duties & Taxes), and
**everything else**. The third heap *is* the taxable value.

That is not assumed. On all four document types the three heaps sum to exactly
zero, and reading the value off the party side or off the third heap gives the
same rupee. Round-off is excluded — it belongs to the invoice, not to the sale,
and leaving it in put the year 6 rupees over his figure.

### Where I did not follow the instruction, and why

He said: **credit note item rows only, `kind='item'`**. I used the third-heap
rule instead. It gives the **identical answer** — on every ordinary credit note
the two routes agree to the rupee, and on his proof year exactly — but a
**`Credit Note (no stock)` has no item rows at all**: 9 such vouchers in REF,
₹74,548, which an item-only rule drops in silence.

He is entirely right about the trap he named: the ledger rows must not be
summed whole. 38 ledger rows carrying ₹51 lakh against 10 item rows carrying
₹21.6 lakh — those 38 are both sides of the same vouchers. Taking only the
third heap is what stops it being counted twice.

---

## The deduction is shown, never hidden

Three figures, on the card itself:

```
NET SALES, FY 2026-27
₹1,80,80,307
−29% against last year
₹2,02,44,255 gross  −  ₹21,63,948 credit notes
excluding GST
```

Same shape on purchases with debit notes. Same on the customer list (gross ·
less returns · lifetime net), on each item (gross · less returns · net value),
and on a customer's own screen, where a credit note is marked **returned** and
its figures print in red with a minus.

---

## Sum the parts, compare against the whole

His rule, and it earned its place inside a minute.

The first version of the items report came out at **₹24.78 crore** against net
sales of **₹21.34 crore**. The reconciliation line is what said so. The cause
was mine and brand new: `doc_type like 'Sales%'` also matches **SALES ORDER** —
1,154 item rows, ₹3.52 crore of things merely ordered and never sold. Purchase
Order is the same trap on the other side, ₹12.69 crore.

**Prefixes are gone. Every document type is now named in full.** An order is an
intention and a challan is a movement; neither is a sale.

What remains after the fix is **₹7.96 lakh**, and it is named on the screen
rather than hidden: invoice lines that carry no item name — Service Charges
₹14.9 lakh and freight — and credit notes with no item line. Real sales value,
with no machine to put it against.

The customer list reconciles **exactly**: ₹1,80,80,307 this FY and
₹21,33,62,628 lifetime, parts and whole.

---

## What the tests hold now

Five new assertions, pinned to figures he verified himself:

```
the headline sales figure is NET, not gross and not GST-inclusive
and the deduction is shown on the card, not hidden
the card says the figure excludes GST
the GST-inclusive total appears nowhere on the reports screen
the items report sums its parts and compares them with the whole
```

Proved by putting the gross figure back as the headline — the first assertion
named it, and the file was restored byte-exact.

```
admin-permissions  28/28   busy  217/217   cold-open  108/108
nav  46/46         phone  130/130          sweep  43/43
check-live: main matches the repo
```

Migrations 68–70 recovered into `supabase/migrations/` and each verified by md5
against the database's own fingerprint.

---

## BLOCKING

**The material-price headline** is still spent-divided-by-bought rather than
the simple average, for the reasons in docs/35 — the simple average says pipe
is up 142% and sheet down 42% over the same two months. Both are on the screen.
One line switches it.
