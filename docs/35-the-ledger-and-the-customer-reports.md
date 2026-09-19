# The party ledger, and the three customer reports

**Date:** 19 Sep 2026 · **Status:** live on main · Migrations 64–67

---

## First: the approval prompts

He approved over a hundred prompts on this one task and said so, hard. The
rule was already in docs/00 from 11 Sep and had slipped back.

It is now the **first section of docs/00**, and it is a setting rather than a
good intention: `.claude/settings.json` carries the allowlist. Asking is
reserved for deleting a Supabase project, dropping a table or column, deleting
a file Claude did not create, and anything that destroys data that cannot be
got back.

> A prompt he has stopped reading is worse than no prompt, because it is a
> guard everyone believes in and nobody uses.

---

## A live bug found on the way in

`busy_monthly_totals` — the Reports screen — told one voucher from the next
with `fy + vch_type + vch_no`. **Doc 19 retired that key back in migration 41**
and said exactly why: `vch_no` is the number people say out loud, it repeats,
and two bills numbered 167 are two bills. That function never got the message.

| | true | shown |
|---|---|---|
| REF vouchers | 10,677 | 10,332 — **345 dropped** |
| REF turnover | ₹67.64 cr | ₹66.26 cr — **₹1.38 cr missing** |
| REF GST | ₹8.64 cr | ₹8.48 cr — **₹15.9 lakh missing** |
| RS vouchers | 859 | 858 |

A dropped voucher is not a rounding difference. It is a whole bill, with its
tax, gone from a turnover figure, and nothing said so. Migration 64 keys it on
`company + fy + vch_code`. Checked as the signed-in owner: 10,677 vouchers,
₹67.64 crore, ₹8.64 crore.

---

## THE LEDGER: the key is `ledger`, not `party`

This is the trap of the whole screen, and the wrong answer looks right until
you add it up.

`busy_history` keeps **every line of a voucher**. A sales invoice to Hindon is
four rows — Hindon, Sales, CGST, SGST — and the `party` column carries the
voucher's party on all four. So summing `debit - credit` over
`party = 'HINDON…'` sums a voucher against itself and comes to **exactly
zero**. Which it did, across 17 rows. Zero is a number that looks like an
answer.

Worse: `party` is not even the party on a receipt. Payments and receipts carry
the **bank** there — 8 distinct values across 18,040 rows. The party's own line
is the one where `ledger` is the party's name.

**Checked against Busy's own figures, REF 2025-26, to the rupee:**

| | opening | movement | closing |
|---|---|---|---|
| HINDON METAFORMS | −4,83,537 | +5,24,787 | **41,250** |
| JUNEJA STEEL SALES | 40,31,821 | −13,99,280 | **26,32,541** |
| T I CYCLES OF INDIA | 8,70,000 | −8,70,000 | **0** |

And each closing equals the **next year's opening row in Busy** — which is the
check that the arithmetic is Busy's and not mine.

### Cr and Dr on every line, and why it is not decoration

Hindon's own year proves it. The balance runs −4,98,178 **Cr**, a receipt of
₹3,00,000 takes it to −1,98,178 **Cr**, the next one takes it to +22,588
**Dr**. Without the suffix the number simply gets smaller and then starts
growing again, and nothing on the screen says the debt changed sides.

Positive is Dr and RECEIVABLE, negative is Cr and PAYABLE. An overpaid
supplier flips to Receivable by itself — no special case.

### Opening at a date that is not 1 April

Busy gives an opening balance per financial year, undated. For a range
starting 1 April that row **is** the opening. For any other start it is that
row plus everything that moved between 1 April and the range start. Both give
the same answer on 1 April, so there is one rule and not two. Verified by
splitting a year: closing at 31 Jul = 19,638 = opening at 1 Aug, and both
paths close at 41,250.

If a year's opening row is missing, the anchor rolls back to the last year
Busy did give us and the screen **says which year it anchored on**.

### The undated opening rows

All 1,447 of them. They are not listed as entries — they are the opening
balance, and listing them would count the same money twice — but the screen
says how many there are in words rather than dropping them in silence.

### Download

- **Print / save as PDF** — the browser's own print-to-PDF. No library, works
  the same on a phone, and what he sees before saving is what comes out.
- **Download for Excel** — a CSV with a byte-order mark, which is what Excel
  opens on a double-click. Called that rather than "Excel" because it is a CSV
  and the name should not lie.

**The letterhead is REF's, and prints only under REF.** RS Industries is a
separate firm with its own GST number, and that number is not in the ERP yet —
so under RS the sheet carries the firm's name and says the registration
details are not held here. Putting one firm's GSTIN on the other firm's
document is not a formatting slip; it is a wrong document sent to a customer.

---

## THE THREE REPORTS

They live as tabs inside Reports, not as new menu lines — the menu order is
locked in doc 11 and Reports is one line of it.

### 1 · Customers

Sorted by lifetime, change coloured, quiet in days then years, quiet chips
with live counts. His own figures reproduce: **Spur ₹4,90,936 last year and
nothing this year, quiet 185 days. Atlas ₹1.58 crore lifetime, 6.0 years
quiet.** Click one for year-by-year bars, what he buys most, and every invoice.

**Value is net of GST.** The customer's own ledger line carries the invoice
including GST; the Sale line carries it without. The one without is the one
that reproduces the figures he already knows.

### 2 · Items sold

**No lowest-to-highest rate column**, as instructed and for the reason given:
an Inclined Slat Conveyor runs ₹1,55,000 to ₹12,00,000 because the machine
type is the item and the size is in the description. Open an item to see every
sale with its size.

### 3 · Material prices, then and now

Pipe · Angle · Channel · Sheet, with the reference month **typed**, not a
fixed button. A month counts only with three or more purchases in it — his own
threshold, the one behind the 98 months he verified.

It **never substitutes a month in silence**: "No Channel purchases in Jul 2026
— nearest is Mar 2026." A material whose latest month is older than the others
carries "no buys since Mar 2026", so a 0% change reads as absent data rather
than as a steady price.

The margin line is live: ₹6,80,000 × (1 + 60% × 12.2%) = **₹7,29,776**, with
the 60% editable and the reasoning printed under it.

---

## THE ONE PLACE I DID NOT DO AS ASKED

**The brief said simple average, stated as such. The headline is not the
simple average.** Measured on the real rows it cannot carry a headline:

```
PIPE, Sep 2026, 10 purchases
  simple average of the rate   213.54     <- one line in the month is 798
  median rate                   73.10
  spent / quantity              65.11
```

Over the same two months the simple average says **pipe is up 142% and sheet
is DOWN 42%**. The quantity-weighted figures say both are up about 18%.

The cause is the one that shapes every screen here: the item is "PIPE" and the
size is in the description, so one row can be a rate per kilo and the next a
rate per length. Averaging those treats them as the same number.

So the headline is **spent divided by bought** — literally what the steel cost
— and the **simple average is printed beside it, named, on every row**. Both
are on the screen; neither is hidden. And the one-line "steel up about 12.2%"
**is** a simple average — of the four materials, which is the level where a
simple average is the honest thing.

**Say the word and the headline switches to the plain average. It is one line.**

---

## THREE OF YOUR FIGURES DID NOT REPRODUCE

- **"159 of 255 customers"** — that is **REF and RS added together** (228 + 27
  customers, 139 + 17 quiet). The one thing no screen here may do. On REF
  alone: **139 of 228** quiet over a year, 172 over six months, 107 over two
  years.
- **"Pipe ₹45 in 2015 to ₹102 now"** — the ₹45 is right (₹44.84, Apr 2015),
  and so are the 98 months with three or more purchases. **₹102 does not
  reproduce** under any measure: the latest month is ₹65.11 weighted, ₹73.10
  median, ₹213.54 plain average.
- **`docs/16-reports.md` does not exist in the repo.** Nothing here mentions
  Spur, Atlas, "Quiet for" or Inclined Slat. Built from your prompt instead;
  this document is the design record.

---

## SIX FAULTS FOUND BY LOOKING AT THE PICTURES

1. **A 320px empty gap under the party box.** `flex: 1 1 320px` on a row that
   becomes a column means 320px of *height*. Inline flex-basis beats the media
   query meant to undo it, so it is a class now.
2. **The whole material comparison was missing on a phone** — the table sat in
   a `.tbl-wrap`, which a phone hides by design, and had no cards. Under a
   heading saying steel was up 12%.
3. **Same again** in the customer panel: "What he buys most" and "Every
   invoice, newest first" were headings with nothing under them.
4. **Same again** on five older screens — month by month, GST, the years list,
   what has gone from Busy, the upload totals. All of them had passed the
   overlap sweep, twice, because nothing overlapped. There was nothing there.
5. **"Nothing sold yet" printed over 829 items.** `drawItems()` already existed
   further down the file for the upload screen. Declarations hoist, the later
   one wins, and the reports screen silently called the uploader's. No error,
   no warning.
6. **The sweep's own card-open step tested the wrong screen**, clicking a card
   that was hidden.

### What was done about the pattern, not the six

- `twoWay()` writes a table and its cards from **one set of rows**, so they
  cannot drift.
- `mirrorToCards()` builds cards **from the table that was just rendered** —
  the same rows, watched by a MutationObserver, so a new column appears in the
  cards by itself and there are no call sites to forget.
- **The sweep now fails any hidden table that has no cards beside it.** That
  one guard catches all four of faults 2–4, on any screen, for ever.
- **`check-page-set.js` now refuses two functions with one name in one page.**
  Proved by putting the collision back: it names both line numbers.
- **The sweep takes full-page screenshots**, not the first 844 pixels.

---

## The suite

```
check-no-positional-cells / check-page-set / check-rpc-calls   pass
admin-permissions.test.js        28 of 28
busy.test.js                    209 of 209
cold-open.test.js               108 of 108
nav.test.js                      46 of 46
phone.test.js                   130 of 130   (+10 for the ledger)
sweep.test.js                    42 of 42    40 screenshots, phone and desk
check-live.js                   main matches the repo
```

Migrations 64–67 recovered into `supabase/migrations/` and each verified by
md5 against the database's own fingerprint.

---

## The RS letterhead — closed the same day

He sent an RS tax invoice. Both firms now print their own registration
details, and neither prints the other's:

```
RS INDUSTRIES
#304F, Sua Road, Industrial Area-C, Dhandari Kalan, Ludhiana - 141014
GSTIN 03CCTPS7440B1ZI · PAN CCTPS7440B · 99154-58452 · rsindustries.ldh@gmail.com
```

**The PAN is derived, not copied.** The invoice left its PAN field blank. The
PAN is the middle ten characters of the GSTIN by construction, and that rule
reproduces REF's own known PAN from REF's own GSTIN exactly, so it was checked
before it was trusted. The fourth letter, P, agrees with a proprietorship.

And it is now a rule the tests keep: **each letterhead carries its own GST
number and never the other firm's**, and each PAN is the one inside its own
GSTIN. Proved by putting REF's number on the RS sheet on purpose — the test
named it.

Both sheets were rendered and looked at, not merely asserted. That is where
the last fault came from: `Cr` and `Dr` were printing flush against the figure
— `4,83,537.00Cr` — because the screen's stylesheet is not in the print
window.

---

## BLOCKING

- **The simple-average headline** on material prices, above. My call, made
  against the brief, with the evidence and a one-line way back.
