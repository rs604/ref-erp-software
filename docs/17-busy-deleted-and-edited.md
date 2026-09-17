# Busy Data — deleted and edited invoices

**Date:** 17 Sep 2026 · **Status:** applied to Mumbai, pushed
**Migrations 35–38 · `busy.html` gains an owner-only screen**

---

## The problem

- The accountant sometimes deletes or edits an invoice after it was created
- Busy's own `DeletedInfo` table records **only a date and an amount, not the
  voucher number**, so it cannot say what went
- So we find out by **comparison**: the sync uploads the whole current-year file,
  and anything the ERP holds for that year which is no longer in the file was
  deleted in Busy

---

## The dangerous part, and how it is prevented

This is the one thing in this change that could have gone very wrong.

- Raghbir will take old financial years off the PC once the import is checked
- **If the comparison ever ran against a year that was not in the upload, every
  row of that year would be marked deleted in one sweep** — twenty thousand rows,
  silently, with no way afterwards to tell which were real deletions
- So the sweep is **scoped to one company and one year, both named by the caller**.
  It cannot reach any other year, by construction, not by care
- A year that stops being uploaded is simply never compared again

**Tested:** loaded 2023-24 and 2024-25, then re-uploaded only 2024-25 with a row
missing. The missing 2024-25 row was marked deleted. **Both 2023-24 rows stayed
live and none was marked deleted.**

---

## What happens now

| | |
|---|---|
| A row is in the file | Inserted, or updated |
| Quantity, rate or amount changed | Row updated, **old value kept** in `busy_history_changes` |
| A row the ERP holds is gone from the file | `deleted_at` set. **The row is never removed** |
| A deleted row turns up again | `restored_at` set, and both dates stay |
| A year is no longer uploaded | Frozen. Kept for good, never compared, never touched |

- Deleted rows disappear from **price history, challans and reports** — otherwise
  a deleted invoice would go on setting the price
- They also leave the median used for the extreme-rate flag
- An **owner-only screen** shows what went and when

---

## Three bugs found by testing, before they reached anyone

**1. Loading two years in one go failed**
- The import built a scratch table marked "drop on commit", which is only cleared
  when the transaction *ends*
- Raghbir keeps the current year **and one prior** on the PC, so the sync sends two
  years together — and the second one died on *relation already exists*
- This was not a test artefact. It is exactly how the sync is meant to run

**2. Every row looked edited**
- The edit check compared stored against incoming **as text**. A quantity of 10 is
  stored as `10.0000` and arrives as `10` — same number, different text
- So every unchanged quantity, rate and amount counted as an edit: **three false
  entries per row, about 68,000 on the first re-sync**, burying the few that were real
- Now compared as numbers and only written down as text
- **Tested:** re-uploading an identical file now records nothing at all. Changing
  one rate records exactly two entries — the rate and the amount — and not the
  quantity, which did not change

**3. The old import entry point could not notice a deletion**
- `busy_import_rows` is not told which year it is loading, so it cannot compare
- It now refuses and names the right function, rather than quietly loading data
  with no deletion check

---

## On the screen, in plain words

The owner-only screen opens with this, so nobody wonders why an old invoice never
changes:

> **Why a 2018 invoice can never change.** Each sync compares only the years that
> are still on the office PC. Anything in those years that has gone from Busy is
> marked deleted here — the row is never removed. Once you take an old year off
> the PC it is **frozen**: kept here for good, never compared again, never touched.
> You keep the current year and the one before it, because late entries get posted
> into the previous year. So the older years simply stop changing, and nothing is lost.

Below it, a **Years held** table: every year, how many rows, how many marked
deleted, when it was last seen in a file, and whether it is still checked each
sync or frozen. Frozen is **worked out**, not typed — a year is frozen once it
stops appearing in uploads, so nobody has to remember to set it.

Then **Gone from Busy**: date, year, type, voucher number, party, item, quantity,
amount, and when we noticed. A row that came back is marked.

---

## Not built, as instructed

- **The parser extension for voucher types 19 and 16** (GST paid and the monthly
  computation). Raghbir is sending an updated parser that adds payment and journal
  vouchers as their own rows. Nothing here assumes its shape
- The uploader `.exe` and the one-time history load — both still need a Windows
  machine and the real files

---

## Drift check

| | |
|---|---|
| Migrations applied to Mumbai | **41** |
| Files matching the applied SQL exactly | **41** |
| Applied but missing a file | **0** |
| Files in the repo not applied | 1 — `18_create_login_for_party`, known and explained in doc 15 |
