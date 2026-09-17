# Busy Data module — phase 1, the database

**Date:** 17 Sep 2026 · **Status:** schema done, applied to Mumbai, pushed
**Migrations:** 27, 28, 29 · **No data loaded yet, on purpose**

---

## First — the document I was told to read does not exist

- The build prompt says to read `docs/14-busy-import-module.md` before starting
- **It is not in the repo.** Not on my branch, not on main, not anywhere in the
  history. Only doc 00 was there to read
- I did not stop, because the build prompt itself carries the full design and
  nothing in it was ambiguous
- But if doc 14 holds anything the prompt left out, I have not seen it
- Same thing happened before Phase C. Worth checking how these documents are
  getting to GitHub

---

## What was built

- **3 new tables, 5 new policies, 2 new permissions, 3 new views, 6 functions**
- Tables 81 → **84**. Policies 218 → **223**. Permissions 59 → **61**
- All three migration files are in GitHub and verified by fingerprint against
  what actually ran

| Table | What it is |
|---|---|
| `busy_history` | The read-only copy of Busy's records. Columns exactly as the parser outputs |
| `busy_import_batches` | One row per file loaded. Where the last-sync stamp comes from |
| `busy_sync_settings` | Times of day, uploader version, failure-email threshold |

**The parser was not touched.** I read it and shaped the table around what it
actually outputs, column for column.

---

## The two-firm rule is now structural, not a promise

This was the one that could not be broken, so it is not enforced by a filter
someone might forget.

- **A signed-in user cannot read `busy_history` at all.** Checked: `false`
- They read `busy_history_ref` or `busy_history_rs`, and the **menu path** picks
  which. Checked: `true`
- **There is no screen that could combine the two firms, because there is nothing
  for such a screen to select from**
- A dropdown was never built, so there is nothing to set wrong

---

## Two bugs I found by testing my own work

Both would have shipped silently.

**1. The import would have refused the automatic sync**
- My permission check allowed a signed-in person or the owner
- The twice-daily sync arrives through an edge function as the **service role**,
  with nobody signed in — so it would have been refused every time
- Fixed in migration 28

**2. Every single search returned nothing**
- My rule "every number typed must match exactly" required each number to be its
  own word, surrounded by spaces
- But a pipe size is written glued together — `80X40X2.5` — so `80` is never its
  own word, and the guard threw away every row
- Fixed in migration 29: a number counts as present when what sits either side of
  it is not a digit or a dot
- **This is exactly the rule that protects against showing the wrong price, and I
  had it inverted.** It now works and is tested

---

## Search, proven

Fourteen checks against real rows, in a transaction that was rolled back.

| Typed | Result |
|---|---|
| `80X40X2.5` | the 2.5 pipe only |
| `80 x 40 x 2.5` | same row — spacing ignored |
| `80x40x3` | the 3 pipe only |
| `80X40X2.5` — does it return the 3 pipe? | **no. Zero rows.** The rule holds |
| `AGARWAL` (typo) | finds AGGARWAL — fuzzy allowed, because no number was typed |
| `aggarwal pipe 80x40x2.5` | found, words in any order |
| REF search returning RS rows | **zero** |
| same search under RS | RS rows only |

Also proven: re-importing the same file inserts 0 rows and updates the existing
ones, so the load is safe to repeat.

---

## Three things the real data says

**1. Busy writes dates as MM/DD/YY, not day-first**
- `04/13/15` is 13 April 2015. Confirmed from the sample: the first number never
  goes above 12, the second goes to 31
- **This is a silent-corruption risk.** A server reading day-first would turn
  `04/01/15` into 4 January and nobody would notice
- So the import converts it **explicitly**, never by an automatic cast. Tested:
  `04/01/15` → 2015-04-01 and `04/25/15` → 2015-04-25

**2. Rows with no quantity are 6% of the data, not most of it**

> **Corrected 17 Sep 2026.** My original figure here came from the 200-row
> sample and said "most of them". Raghbir checked all 22,732 rows: it is
> **1,406 rows, about 6%**. The sample happened to be the worst year.
> The conclusion below was right; the size of it was not.

- **1,400 carry real money with no quantity** — ₹6,05,210 for an MTB CONVEYOR,
  ₹9,25,447 for J S Engineers. **Only 6 rows are truly blank**
- These are **lump-sum bills** — a complete machine sold as one job, not by the
  piece. They are real history and must not be hidden
- The parser forces rate to 0 when quantity is 0, so on a screen they would look
  like a price of zero
- Added `is_lump_sum`, so a screen can say **"no rate — billed as one job"**
  instead of showing ₹0 as though it were a price

**3. Descriptions are on 37% of rows overall, and rising**

> **Corrected 17 Sep 2026.** I reported "not one row has a description",
> which was true of the sample and wrong about the data. Raghbir checked all
> 22,732 rows.

- **37% overall.** 2023-24 is 58%; recent years run 41-45%
- My sample was REF 2015-16, where **1 row in 409** has one — the worst year in
  the set
- **Descriptions are there on the years that matter for prices**, which is what
  the module depends on
- Search is built and tested using the pipe example from the build prompt, but
  still worth checking against a real described year early in the load

---

## What is NOT built, and why

**The uploader .exe — cannot be built here**
- This container is Linux. There is no Windows compiler and no PyInstaller
- It also needs decisions I should not make alone: how it is signed, where it is
  downloaded from, and how the upload token is kept on that PC
- Everything it talks to is ready: the schedule, the version fields and the
  failure-email threshold are all in `busy_sync_settings`

**The one-time history load — no files to load**
- There are no `.bds` files in this container, and `mdbtools` is not installed
- So the 22,732 rows cannot be loaded or checked from here
- The import function is built, tested and idempotent, ready for them

**The screens** — price history, challan view, reports, GST. Schema first

**The GST paid figures** — the ledger lookup by NAME and the VchType 19 / 16
split are recorded in the build prompt and will work against the parser, but
cannot be verified without the real files

---

## The extreme-rate threshold — settled 17 Sep

- A flat ₹50,000 was the wrong test, as Raghbir pointed out: a gear box at
  ₹47,621 and a hoist at ₹83,000 are both normal prices
- Replaced in migration 30 with **a multiple of the median rate for the same
  item**, default 10x. See `docs/16-busy-module-phase-2.md`

---

## Still open from earlier phases

- Add **F** to the PAN rule, or partnership firms cannot be registered
- Whether to drop the old `uom` column on items
