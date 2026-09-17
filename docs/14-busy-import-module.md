# Busy import module — decisions locked

**Date:** 13–17 Sep 2026. **Status:** designed, database traced against real data.
Ready to build.

---

## The problem it solves

- Raghbir bills in **Busy Accounting Software**. Purchase bills, POs, proforma
  invoices, sales invoices
- **Busy splits its database by financial year** — one file per FY
- To check a past price, the accountant opens each FY file one at a time,
  searches, closes it, opens the previous year
- Raghbir cannot check anything himself from outside the office

**What he wants:** search any past price, for any party, any item, from his
phone. Without opening Busy.

---

## TWO COMPANIES — never merged

Raghbir owns two legally separate firms. **They share nothing.**

```
Busy
├── REF                    (Raghbir Erectors & Fabricators)
│   ├── Price history
│   ├── Ledgers
│   └── Reports
└── RS Industries
    ├── Price history
    ├── Ledgers
    └── Reports
```

- **A `company` column on every imported row.** Not a filter someone sets — the
  menu path decides it
- Under RS Industries, every screen only ever queries RS Industries rows. **No
  dropdown, so no chance of a mix-up**
- **No report combines them.** There is no screen that could
- The Busy folder already separates them by company number, so the import knows
  which is which automatically

**When Busy history reaches the Customer and Vendor 360 view, the same rule
holds absolutely.** A REF customer's 360 view shows REF history only. RS
Industries data never appears there, and the reverse is equally true.

**Who sees it:** three people — Raghbir, his brother, the accountant. Settled
with the rest of permissions later.

**Why one column and not two databases:** one codebase, one set of screens, one
sync. A third company later is a row in a table, not a project.

---

## WHAT THE REAL DATABASE TURNED OUT TO BE

Traced against `COMP0003`, FY 2024–25, on 17 Sep 2026.

### It is Microsoft Access

- The files are `.bds` — Access databases with a renamed extension
- **Readable with no licence and no Busy installation**
- `db.bds` (11 MB) — the master file: parties, items, settings
- `db12024.bds` (36 MB) — one financial year of transactions
- `locks.sys` — ignore

### The tables that matter

| Table | What it holds |
|---|---|
| `Tran1` | Voucher headers. 1,976 in FY2024 |
| `Tran2` | Lines. `RecType 4` = items · `RecType 3` = tax and ledger lines |
| `ItemDesc` | **Description lines** |
| `Master1` | 838 parties and 1,259 items in one table, split by `MasterType` |
| `MasterAddressInfo` | Address, phone, email, TIN, PAN per party |

### The description problem does not exist

The worry was that descriptions sit as rows below an item and would need tying
back to the right line. **They do not.**

- `ItemDesc` has **`Desc1` through `Desc20` as columns**, keyed on `VchCode`
  plus `SrNo`
- Each item's description lines come across in **one row, already attached to
  the correct line**
- There are also `Desc1SL` to `Desc4SL` at 255 characters for longer text

### THE FINDING THAT SHAPES EVERYTHING

A real invoice, voucher 2, to Aggarwal Pipes & Structures:

```
LINE 1: PIPE   qty 678   amount 38,985
        SIZE 80X40X2.5 MM ISI MAKE
        25 LENGTH
        STD. LENGTH 6000
        WEIGHT OF 1 LENGTH = 27.100 KGS

LINE 2: PIPE   qty 162   amount 9,315
        SIZE 80X40X3 MM ISI MAKE
        ...
```

**Every line says just "PIPE". All five of them.** The size, the make, the
standard length and the weight are all in the description.

**Therefore:**

- **Searching by item name is useless.** Everything is "PIPE"
- **The search must run on description text.** This was already the plan; it is
  now proven necessary rather than merely sensible
- **It confirms that mapping Busy items to the ERP item master would be
  pointless.** There is nothing meaningful to map

### Tax lines

Tax sits in `Tran2` as `RecType 3`, pointing at a ledger in `Master1`:

```
CGST              rate 9%   on 107,525   =  9,677.25
SGST              rate 9%   on 107,525   =  9,677.25
Rounded Off (+)   rate 0%   on 0         =  0.50
```

### Still to confirm

- **Which `VchType` number is which document.** FY2024 holds 14 different types.
  Sales, purchase, PO and proforma each have their own number — to be identified
  by tracing one known invoice of each kind
- **GSTInfo is empty** in this file. GST numbers may sit in `MasterAddressInfo`
  or elsewhere. Only matters if 360-view linking is ever built

---

## The governing decision: import raw, map nothing

- **One table, `busy_history`.** Read-only, clearly marked as imported
- **Names exactly as Busy has them.** No cleaning, no correction, no mapping
- Busy names will never match the ERP's masters — accepted, not a problem to
  solve

**Why:** a mapping table for thousands of items would take weeks to build and be
out of date within months. And as the PIPE example shows, there is nothing
sensible to map anyway.

**How you find things without mapping:** you type. Search covers party names and
description text. That is how anyone would look regardless.

---

## THE UPLOADER — what runs on the accountant's PC

### It does not parse. It only uploads.

```
Accountant's PC  →  uploads the Busy files  →  cloud parses  →  Supabase
```

**Why this is the right design**

- Nothing to install on that PC beyond one small program. No Python, no Access
  driver, no dependencies
- **If the parsing logic ever changes, it changes in the cloud.** That PC is
  never touched again
- New accountant, new PC, new Busy version — the upload still works

### What gets installed

- One `.exe`, about 5 MB, in a folder such as `C:\RefSync\`
- A `config.txt` beside it holding the Busy folder path and nothing else
- **First run asks for the Busy folder once.** It remembers thereafter
- The script can also search common locations and offer what it finds

### If the PC or the folder changes

- Copy the folder to the new PC, run it once, point it at the new Busy location
- Ten minutes for whoever sets up the machine

### The accountant sees nothing

- **Completely silent. No window, no popup, no taskbar icon**
- Task Scheduler runs it hidden. It copies the files, uploads, exits. Under a
  minute
- **It never opens Busy and never writes to it.** It reads the files, the same
  as copying them
- Runs twice daily — morning and evening. Previous day's entries are in before
  11:00 AM

### Health check

If the sync fails three days running, Raghbir gets an email. Otherwise it could
stop silently and nobody would find out until a price was needed.

**Confirmed:** the accountant's PC has permanent internet.

---

## The one-time history load

- Raghbir zips the FY files and **uploads them through the ERP's own screen**
- He watches it happen and confirms the numbers before trusting them
- After that the daily sync takes over and nobody touches it again

### The sequence matters — import first, remove after

1. Send all FY files for both companies
2. Parser built and tested against real data
3. **Import every year**
4. **Check the numbers** — a few invoices from memory, total sales for a year
5. **Then** remove old years from the Busy folder

**Nothing is removed before step 4.** If something imports wrong and the source
is gone, it is gone.

### The ERP keeps its own copy

- **A copy, not a mirror. Nothing syncs backwards**
- Delete ten years from the Busy folder and every row is still in the ERP
- That is the whole point: the history survives whatever happens to Busy
- **But keep a backup of the original files regardless.** The accountant may
  need them for an assessment or a notice, and a copy in the ERP is not the same
  as Busy's own file

---

## Reports

### Sales — straightforward and safe

- **Sales till date** — running total for the financial year
- **Month on month** — a bar per month
- **This year against last year** — same months side by side, with the difference

All three are sums of invoice values. Nothing to get wrong.

### Purchase — the same three

### GST — shown as fact and estimate, clearly separated

**What is safely computable**

- **Output GST** collected on sales this month
- **Input GST** paid on purchases this month
- **The difference**

**Why that is not a "payable" figure**

- Some input credit is ineligible and cannot be claimed
- Reversals, reverse charge and credit notes all adjust it
- **The accountant works that out at filing. The ERP does not know any of it**

**So the screen reads**

> **GST paid last month ₹52,300** — actual, from Busy, 07 Sep 2026
> **This month so far:** output ₹2,40,000 · input ₹1,85,000 · difference ₹55,000
> — indicative only. The accountant's filed figure is the real one

**Left number is fact. Right number is an estimate.** Labelled as such, because
a number labelled "payable" is one somebody eventually pays against.

**Over time this becomes genuinely useful** — twelve months of actual payments
beside twelve months of computed differences. If they track closely the estimate
is reliable. If they diverge, input credit is not all being claimed.

**Open:** which ledger the GST payment is posted to, and which voucher type.
The accountant will know both in seconds.

---

## The party ledger — phase 2

Built only after the import is proven and trusted.

- Every invoice, payment, credit note and debit note per party
- Opening balance per financial year
- **Shows Busy's own closing balance. Imported, never recalculated**
- **Why:** if the ERP's figure disagrees with the accountant's by ₹500, nobody
  trusts the screen again. A ledger has to add up or it is worse than useless

### Download

- Pick a party, pick a date range, download **PDF or Excel**
- Date, voucher number, type, debit, credit, running balance
- Opening balance at the start of the range, closing at the end
- Company header on the PDF, same as the PO

**One caution:** this becomes a document that might be sent to a customer during
a payment dispute. **The source and timestamp must be printed on it** — *"From
Busy Accounting, as at 5:30 PM, 13 Sep 2026"* — or it is a number nobody can
stand behind.

**The accountant's ledger stays the authority.** This is for looking up and
sharing, not reconciling.

---

## "Live" means as at the last sync

- Current as of the last sync, not real time
- **Every screen carries the timestamp** — *"as at 5:30 PM, 13 Sep"*
- **Why not genuinely live:** it would mean reading the office PC over the
  internet continuously. Fragile, and a security exposure for no real gain

---

## Deferred, with the reasoning kept

### GSTIN linking to the 360 view

If linking is ever wanted, **map parties on GSTIN. Never map items.**

- **GSTIN is exact.** No fuzzy matching, no judgement
- Already in both systems, and the ERP makes it mandatory
- Nothing to maintain. A new party links the moment its GSTIN is entered
- **And the company separation holds absolutely.** REF customers see REF history
  only

### The VAT-era problem — decided: do not solve it

- GST came in July 2017. Before that, parties carried a **TIN**
- **TIN cannot be converted to GSTIN.** Old TIN was a state code plus nine
  digits; GSTIN is state code plus PAN plus entity number plus checksum. They
  share nothing
- **And the data is not worth it.** A 2015 price says nothing useful today
- **So:** import everything including the VAT era, but pre-GST data stays
  searchable by name only. If a linked one matters, one tap links it and the
  link is remembered

### Last price on a quotation

Needs to know which Busy party and item are meant. Without mapping it cannot.
**Revisit only if the ERP's own history proves insufficient.**

---

## Still needed from Raghbir

1. **All remaining FY databases, for both companies.** Zipped
2. **The GST payment ledger name and voucher type** — from the accountant

---

## Who builds what

- **The design chat** has the real files, writes and tests the parser against
  actual data, and produces the table structure
- **Claude Code** gets the tested parser and the structure. It builds the
  database, the uploader and the screens. **It never needs the data files**
- **The data never travels through either.** The uploader sends it, the cloud
  parses it, the rows land in Supabase — the same way Claude Code built 81 tables
  without ever seeing a vendor or an item

---

## The future state

- When billing moves into the ERP, new rates appear in the **same Price History
  screen** alongside the Busy history
- When Busy is switched off, **the history is already here. Nothing to migrate**
- That is the whole point of importing it raw and early

---

## WHAT THE REAL DATA TURNED OUT TO BE — verified 17 Sep 2026

All 24 files parsed. **47,635 rows, 47,635 distinct keys, 0 lost.**

| | REF | RS Industries |
|---|---|---|
| Item rows | 21,307 | 1,425 |
| Ledger rows | — | — |
| **Total both firms** | **47,635** | |

- Dates run **2015-04-01 to 2026-09-16**
- GST: REF has **11 payments** and **179 computations**. RS has **none** — correct, not a fault

### The key is vch_code, NOT vch_no

`vch_no` cannot identify a row:

- **Blank on every ledger row.** All of them, no exceptions
- **It repeats among item rows.** Purchase bill 167 is two genuinely different
  bills — Originativ Solutions on 24 Jun for ₹19,365, and B.R. Tools on 29 Jun
  for ₹56,000

**The key is `company + fy + vch_code + sr_no`.** `vch_no` stays as a column
because it is the number people say out loud and it prints on documents. It is
simply never used to identify a row.

This bug was present from the first migration and would have silently
overwritten rows in the full load.

### Dates are MM/DD/YY in Busy

Confirmed across all 24 files: the first part never exceeds 12, the second
reaches 31. **The parser converts explicitly and outputs ISO.** A server reading
day-first would turn 4 January into 13 April across 22,732 rows and nobody would
notice for years.

### Two row kinds

- `kind='item'` — bills, challans, orders
- `kind='ledger'` — payments and journals. **This is what makes GST-actually-paid
  possible**

Ledger rows have no qty, rate, item or description. **They must never reach
price history.** Scope every price query to `kind='item'`.

### access-parser was tried and REJECTED

A pure-Python reader would have removed the container entirely. It reads **9 of
the 24 files and fails on 15** — every year before 2024, on overflow pages it
cannot follow.

**The trap: it works perfectly on a recent file.** Test one 2025 file and you
conclude it is fine, and you are wrong about 15 of 24.

**mdbtools stays.**

### Voucher types, confirmed by tracing real vouchers

| VchType | Document | How it was identified |
|---|---|---|
| 2 | Purchase Bill | party is a Sundry Creditor, posts to Purchase |
| 9 | Sales Invoice | party is a Sundry Debtor, posts to Sales |
| 11 | Delivery Challan | stock moves, nothing posts to accounts |
| 12 | Purchase Order | stock inward, no ledger posting |
| 13 | Sales Order | stock outward, no ledger posting |
| 16 | Journal | the monthly GST computation |
| 19 | Payment | money leaving the bank |

**Item lines sit in TWO record types** — RecType 2 on bills and challans,
RecType 4 on orders. Missing either loses most of the history.

### Challans are job work, repairs and free issues

Raghbir confirmed: material sent out, returnable or not. The descriptions say so
in his own words — *MATERIAL SEND FOR CUTTING*, *SEND FOR REPAIRING*, *TOOLS
RETURNING BACK AFTER*, *FREE OF COST*.

**Returnable versus non-returnable is NOT a field.** It is free text, written
differently every time. So a pending-returnables screen cannot honestly be built
from this data — the screen says so plainly rather than pretending. In the new
ERP it becomes a real field.

**Both firms bill each other**, so each appears as a party in the other's data.
Correct and expected.

### THE LEDGER IS NOT BUILDABLE FROM THIS DATA YET

Discovered while producing a real statement for Hindon Metaforms.

- **Receipts and payments against a party are not in the parsed rows.** Busy
  records them under voucher types the parser does not read
- **No opening balances either**
- So there is **no balance, no opening figure and nothing outstanding**

What was produced instead is a **billing statement** — what was billed and
delivered in a period, with the source and timestamp on the page. Useful, and
honest about what it is not.

**Phase 2 is therefore bigger than repackaging loaded rows.** It needs another
look at the Busy file for receipt vouchers and party opening balances.

### The closing balance wording — when the ledger exists

- **CLOSING — PAYABLE** or **CLOSING — RECEIVABLE**, decided by the sign
- **And Cr or Dr after the amount:** `₹1,76,810 Cr`
- Both together — Payable for Raghbir, Cr for the accountant. Neither has to
  translate
- **Every running balance carries the suffix too.** A balance can cross from Cr
  to Dr mid-year when a supplier is overpaid; without it the number just drops
  and nobody knows why

### Two data quirks — real, leave them alone

- **Zero quantity with real money: 1,406 rows of 22,732, about 6%.** Lump-sum
  machine sales — ₹6,05,210 for an MTB conveyor. `is_lump_sum` is set by the
  parser. The screen says *"no rate — one job"*, never ₹0
- **Descriptions: 37% overall, 58% in 2023-24, almost none in 2015-16.** The
  years that matter for prices have them

### parser_version on every row

Every batch records which parser read it. **A batch carrying two versions is
refused outright** — that means the file was stitched from two runs, which is
exactly the version skew the rule exists to prevent.

### The lesson this module taught three times

| | Sample | Claim | Truth |
|---|---|---|---|
| Phase 1 | 200 rows | "most rows have no quantity" | 6% |
| Phase 1 | 200 rows | "no row has a description" | 37% |
| 17 Sep | one .bds | "mdbtools is not needed" | fails on 15 of 24 |

**Same shape every time: a sample read as though it were the data.** It cost
nothing on all three because each was checked against the full set before
anything was built on it.

**The rule: a tool, a rule or a number gets tested against the whole set before
anything is built on it. A sample finds things worth checking; it never settles
them.**
