# Busy Data module — phase 2, corrections and the screens

**Date:** 17 Sep 2026 · **Status:** applied to Mumbai, pushed
**Migrations 30–34 · New screen: `busy.html`**

---

## A bug I put into the live site, and have now removed

- In my very first commit I added a line to `version.txt` as proof that pushing worked
- **Every page checks `version.txt` against the version built into it, and reloads
  if they differ.** With my extra line they could never match again
- The result would have been **every page of the ERP reloading itself forever** —
  admin, submit and the login screen
- It never reached anyone: my work sits on a branch, and the live site runs from
  `main`. But merging would have taken the ERP down
- `version.txt` is back to the single number, and all three pages match it again
- **Nothing should ever be added to that file except the version.** It is not a log

---

## The three corrections Raghbir made

He checked my findings against all 22,732 rows. Two of my numbers were wrong.

| What I said | What is true |
|---|---|
| Dates are MM/DD/YY | **Correct.** Confirmed across all 22,732 rows |
| Rows with no quantity are "most of them" | **6%** — 1,406 rows. My sample was the worst year |
| "Not one row has a description" | **37% overall**, 58% in 2023-24. My sample was 1 in 409 |

- Both wrong figures came from reading a 200-row sample as though it were the data
- The conclusions still hold — `is_lump_sum` is right, and search on description is
  right — but I stated them with more confidence than a single year could support
- `docs/15-busy-module-phase-1.md` has been corrected in place so the wrong numbers
  are not left sitting in the record

---

## Extreme rates — now measured against the item, not against a rupee figure

- A flat ₹50,000 was my guess and it was wrong: a gear box at ₹47,621 and a hoist
  at ₹83,000 are both perfectly normal prices
- Now: **a rate is flagged when it is more than 10× the median rate for the same
  item, in the same firm**
- Both numbers are settings — `extreme_rate_multiple` and `extreme_rate_min_rows`
- **Two traps handled:**
  - Lump-sum rows carry no rate, so they are excluded from the median. Otherwise
    the 1,406 of them would drag every median toward zero and flag everything
  - An item needs at least 3 priced rows before anything is flagged. A median
    taken from one row would flag the second one

**Tested:** a PIPE at ₹51,783 against a median of ₹58 is flagged. The ₹47,621 gear
box and the ₹83,000 hoist are not. One row of nine, and it was the right one.

---

## PAN — five entity types

- The fourth letter of a PAN says what kind of entity it is
- Now accepted: **P** individual · **C** company · **F** partnership firm ·
  **H** HUF · **T** trust
- A person must still be P, and an entity must be one of the other four — so it
  still catches a personal PAN typed onto a company record
- **Tested:** F, H, T and C all accepted on a company; P accepted on a person;
  company-with-P and person-with-C both still refused

---

## `items.uom` is gone

- Checked first, as asked: **no screen, no view, no function, no constraint and
  no index reads it**, and the table is empty
- `unit_id` replaced it back in migration 21. Dropped in migration 30

---

## Three more bugs found by testing, before they reached anyone

**1. No signed-in user could read anything at all**
- Migration 27 revoked everything on `busy_history` so no screen could span the
  two firms. That part was right
- But the two company views and the search were `security_invoker`, meaning they
  read the base table **as the caller** — who has no rights on it
- Every one of them failed with *permission denied for table busy_history*.
  **The price history screen would have been dead on arrival**
- Fixed so both guarantees hold: the base table stays unreadable, each view
  carries its own permission test, and the search runs as definer and insists on
  **one named firm per call**

**2. "column reference id is ambiguous"**
- Rewriting the search in plpgsql gave it output columns with the same names as
  the table's, and it refused to run

**3. `median_rate` came back as double precision**
- `percentile_cont` only sorts double precision, so a numeric rate was quietly
  cast. Money is numeric everywhere else here, so it is cast back once in the view

All three were found by calling the function **as a signed-in user** rather than
as the database owner. As the owner everything worked, which is exactly why that
is not a real test.

---

## The voucher double-count trap

- `cgst`, `sgst`, `igst` and `vch_total` belong to the **voucher**, and the parser
  copies them onto every item line
- An invoice with six lines carries its GST six times
- Summing per row would have reported **six times the real tax and six times the
  real turnover** — and it would have looked plausible
- `busy_monthly_totals` sums line amounts per line, but counts tax and voucher
  totals **once per voucher**
- **Tested:** one invoice, three lines, ₹3,540 total and ₹180 tax. Reported as
  ₹3,540 and ₹180, not ₹10,620 and ₹540

---

## The screens — `busy.html`

A separate page rather than another 27,000 lines inside `admin.html`. Same shell,
same colours, same table and form rules as doc 11. Reached from the ERP, and it
links back.

**The two firms are the menu path, exactly as required**
- Six menu entries: three under Raghbir Erectors & Fabricators, three under RS
  Industries. **No dropdown anywhere**
- The firm's name sits in the top bar in its own colour, and the note under it
  names the firm you are NOT seeing
- The database refuses a search that does not name exactly one firm

**Price history** — the main screen
- One box: party, item or description together. Focus lands in it on open
- Filters: document type, date range, how many rows
- Columns: Sr., date, FY, type, voucher no, party, item, description, qty, rate, amount
- Exact matches have the typed letters highlighted; close matches shade the whole
  row yellow and are counted underneath, so a fuzzy hit is never mistaken for exact
- A lump-sum line shows **"no rate · one job"**, never ₹0
- An extreme rate shows the rate with **"usually ₹x"** beside it in amber. Flagged,
  never hidden
- Reads in Indian format — ₹1,50,000

**Challans** — its own screen
- Says plainly, on the screen, that **returnable versus non-returnable is not a
  field in Busy** — it was typed into the description in free words, differently
  every time, so a pending-returnables list cannot honestly be built from it
- But it is searchable: typing *repairing* finds everything ever sent out for repair

**Reports**
- Sales and purchases for this financial year and last, with the percentage change
- Month by month, this year against last year side by side, with the difference
- GST as **estimate only**, labelled as such, never called payable

**Every screen shows the last sync time**, and says the data is as at that moment
and not live. If it has never synced it says so in red.

---

## One thing that cannot be built yet, and why

**GST actually paid is not available.**

- The build prompt traces it correctly: the GST ledger by name, voucher type 19
  for the payment and 16 for the monthly computation
- But **the parser reads only the item lines of bills, challans and orders**
  (record types 2 and 4). Payment and journal vouchers are not in what it outputs,
  so none of that data is in `busy_history`
- So the screen shows the estimate and says in plain words that the actual paid
  figure needs the parser extended to read those vouchers
- I did not extend the parser: it is proven against 24 files and I was told not to
  rewrite it. **That is your call**

---

## Not built, still waiting on a Windows machine and the real files

- The uploader `.exe`, the setup instructions screen, and the download screen
- The one-time history load of 22,732 rows
- Both need things this container does not have
