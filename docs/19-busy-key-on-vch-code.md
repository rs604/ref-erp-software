# Busy Data — the key moves to VchCode

**Date:** 17 Sep 2026 · **Status:** applied to Mumbai, pushed
**Migration 41 · The history load is no longer blocked**

---

## What changed

- Rows are now told apart by **`company + fy + vch_code + sr_no`**
- `vch_code` is Busy's own identity for a voucher, from `Tran1.VchCode`
- **Verified by you across all 24 files:** 47,635 rows, 47,635 distinct keys,
  0 lost
- Checked again here on the 200-row sample: the old key still loses 77 rows, the
  new one loses none

**`vch_no` stays as a column.** It is the number people say out loud and it prints
on documents. It is simply never used again to tell one row from another.

---

## Proven on the rows that showed the bug

The eight rows chosen for the test were the ones that used to collide — **four
distinct keys under the old scheme, eight under the new one.**

| Test | Result |
|---|---|
| Load 8 rows, 4 of which shared the old key | **8 inserted** (would have been 4) |
| The five payments with blank voucher numbers | all 5 survived |
| Both bills numbered 167 | both survived — **₹19,365 and ₹56,000** |
| Same file loaded again | 0 inserted, 0 edited, 0 deleted |
| One voucher removed from the file | exactly 1 marked deleted, and it was the right one |
| The other seven | untouched |
| A file with a blank voucher code | refused, nothing loaded |
| Two rows sharing a voucher code and line | refused, nothing loaded |
| Price history | 3 item rows, no ledger postings |
| GST paid | ₹2,05,299, bank side correctly excluded |

---

## The guard stays on, permanently

As you asked, and I agree with the reasoning. It is now two checks, both running
on every import, for good:

1. **Any row with no voucher code stops the whole file.** Without it a voucher
   cannot be told from the next one
2. **Rows counted against distinct keys.** If they differ the file is refused and
   an example is named

Neither is a temporary measure. A guard switched on only while a bug is known is
no guard at all — and this one caught a fault that had been in place since
migration 27.

---

## Also kept, for the record

- **`is_lump_sum` comes from the parser**, not from a generated column. Every
  ledger row matches "quantity 0 and amount not 0", so the derived version
  labelled every payment posting a lump-sum machine sale
- **`vch_total` is never used for GST.** A journal repeats it on every posting.
  The figure is the posting on the GST ledger itself

---

## The history load can now run

Nothing in the database is blocking it. What it still needs is a Windows machine
and the real files, which this session does not have.

**When it runs, these are the numbers to check before trusting anything:**

| | Expected |
|---|---|
| Item rows, REF | 21,307 |
| Item rows, RS | 1,425 |
| All rows, both firms, all 24 files | 47,635 |
| GST payments, REF (type 19) | 11 |
| GST computations, REF (type 16) | 179 |
| GST ledger rows, RS | 0 — correct, not a fault |

The eleven individual payments are listed in `docs/18-busy-ledger-rows-and-gst.md`.
If any count differs, stop and say so rather than carrying on.

---

## Still waiting on a Windows machine and the real files

- The uploader `.exe`, the setup screen, the download screen
- The one-time history load itself
