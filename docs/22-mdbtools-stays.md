# Busy Data — mdbtools stays, and every batch records its parser

**Date:** 17 Sep 2026 · **Status:** applied to Mumbai, pushed
**Migration 45 · `busy/parse-service/` restored · upload screen takes both**

---

## The reversal, and the reason for it

`access-parser` was tested on one file and read it perfectly. Tested on all 24:

| | |
|---|---|
| Files it reads | **9 of 24** |
| Files it fails on | **15 of 24** |

Every year before 2024 fails — COMP1001 to COMP1006, COMP0019, COMP0002,
COMP0013 and the RS equivalents — with `IndexError`, `TypeError` and *"Could not
find overflow record data page overflow pointer"*. Older Access files spread a
record across **overflow pages**, which the library cannot follow.

**mdbtools reads all 24 without complaint.** It is the right tool and it stays.

- `busy/parse-service/` is restored, byte-identical to what was removed
- `parse_service_url` is a live setting again, no longer marked unused
- The Dockerfile, mdbtools, Cloud Run in `asia-south1` — all of it stands

**The finding is now written into the service's README**, so nobody tries the
same shortcut in a year. The trap is that it works perfectly on a recent file:
anyone testing on one 2025 file will conclude it is fine, and be wrong about 15
of the 24.

---

## The mistake is worth recording, and it is the same one twice over

Raghbir asked for this to go in the document, so here it is plainly.

**A conclusion was drawn from one file and reported as general.** That is exactly
the fault caught twice in my own work in this project:

| When | What was read | What was concluded | What was true |
|---|---|---|---|
| Phase 1 | 200-row sample | "rows with no quantity are most of the data" | 6% — the sample was the worst year |
| Phase 1 | 200-row sample | "not one row has a description" | 37% overall, 58% in 2023-24 |
| Today | one `.bds` file | "mdbtools is not needed" | it fails on 15 of 24 files |

Same shape every time: **a sample read as though it were the data.** It cost
nothing on all three occasions because each was checked against the full set
before anything was built on it — which is the actual lesson. The checking is not
ceremony.

**What follows from it:** before a tool, a rule or a number gets built on, it
gets tested against the whole set, not a convenient piece of it. The sample is
for finding things worth checking, never for settling them.

---

## What was right in the last report and has been kept

**Option B, for the version-skew reason.** Raghbir agreed it is a better argument
than convenience, so recording it once more: put the parser inside the `.exe` and
a parser fix only takes effect when somebody replaces the file on that PC. In the
gap, some files are read by the old parser and some by the new, both writing the
same rows under the same key, and whichever ran last wins — with no way to tell
which produced what. **The `.exe` copies bytes and has no version-dependent
behaviour.** That is the property that makes a new PC safe.

**And now it is visible rather than merely avoided.** `parser_version` is on
`busy_import_batches`, taken from the rows themselves.

- Every batch records which parser read it
- **A batch carrying two different parser versions is refused outright** — that
  means the file was stitched together from two runs, which is the exact skew the
  rule exists to prevent

**Tested:**

| Test | Result |
|---|---|
| A normal load | 2 rows in, parser recorded as `2026.09.17-mdbtools` |
| A batch holding two parser versions | **refused**, naming both, nothing loaded |
| Rows in the table afterwards | still 2 — the refusal wrote nothing |

---

## The upload screen takes both

One screen, one list, two routes in:

- **A rows file** (`.csv`, `.json`, `.jsonl`) is read in the browser, split into
  one batch per firm and year, and handed to `busy_import_fy` directly. No
  service needed — this is how the one-time load will happen
- **A `.bds` file** goes to the parse service, which reads it with mdbtools. If
  the service has no address yet the screen says so on that row, in plain words,
  and the rows-file route still works

Everything else is unchanged and still right: the **whole-year batch rule**, the
**refusal guard**, the **red warning** about checking the numbers and keeping the
originals, the **setup instructions**, and the **`app-downloads` bucket**.

The CSV reader was re-tested after the rebuild — 200 rows, 26 columns, 120 item
and 80 ledger, 200 distinct keys, blanks turned to nothing rather than zero, and
commas, doubled quotes and line breaks inside a quoted description all read back
correctly.

---

## Where things stand

**Waiting on you:**
1. **The rows file** from the mdbtools parser — the history loads from it today
2. **Deploy the parse service** — only needed before the first daily sync
3. **Build the `.exe`** from `busy/uploader/` on any Windows machine

**Still open from earlier:** whether to drop `extreme_rate_threshold` from
Phase 2. `parse_service_url` is no longer on that list — it is live again.
