# Busy Data — no parse service, and where the parser should run

> ## REVERSED, 17 Sep 2026, same day
>
> **The headline of this document is wrong.** `access-parser` was tested on one
> file and worked. Tested on all 24 it reads **9 and fails on 15** — every year
> before 2024, with *"Could not find overflow record data page overflow pointer"*.
> Older Access files spread records across overflow pages, which the library
> cannot follow. **mdbtools reads all 24.**
>
> The container is back and `parse_service_url` is a live setting again. See
> `docs/22-mdbtools-stays.md`.
>
> What still stands from this document: **Option B and the version-skew
> reasoning**, the **whole-year batch rule**, the **rows-file route** on the
> upload screen, and the **CSV reader tests**. Those are all unchanged and still
> correct.

**Date:** 17 Sep 2026 · **Status:** applied to Mumbai, pushed
**Migration 44 · `busy/parse-service/` removed · upload screen reworked**

---

## The container is gone

`access-parser` reads a `.bds` file in pure Python. Raghbir tested it on a real
file — COMP0003/db12025.bds, 87 tables, Tran1 3,591 and Tran2 18,858 rows, read
in 6 seconds, identical to mdbtools.

So: **no system package, no Dockerfile, no container, no Cloud Run, no
`asia-south1` deploy.** `busy/parse-service/` is removed. `parse_service_url` is
left in place but marked as no longer used — nothing reads it, and dropping a
column needs your say-so.

---

## The upload screen now takes the rows file

Reworked, and the one-time load no longer waits on anything being deployed.

- Drop the parser's output file on it — **`.csv`, `.json` or `.jsonl`**
- It is read **in the browser**, split into **one batch per firm and year**, and
  each batch is handed to `busy_import_fy` directly
- **No service, no service key anywhere.** The database checks who is asking
- A `.bds` file dropped by habit is refused with plain words: a browser cannot
  read one, use the parser's output

### The one rule that matters here

**A batch must hold the whole year.** The import marks anything missing from a
batch as deleted, so sending half a year would mark the other half gone. Years
are never split, and the code says so where it matters. If the connection drops
mid-send the whole call fails and nothing is written — a half-sent year cannot
reach the database.

### Tested against the real sample file

| | |
|---|---|
| Rows read from `busy_sample_200_rows.csv` | 200, all 26 columns |
| Kinds | item 120, ledger 80 |
| Rows with no firm or year | 0 |
| Distinct keys under the new scheme | 200 of 200 |
| Blank numbers turned into nothing, not zero | yes — the database refuses `''` as a number |

And the awkward cases a description will actually contain:

| Typed in the file | Read back as |
|---|---|
| `"SIZE 80X40X2.5 MM, ISI MAKE \| 25 LENGTH"` | comma kept inside the field |
| `"HE SAID ""ISI"" ON IT"` | `HE SAID "ISI" ON IT` |
| a field with a line break in it | both lines, one field |

---

## Your question: A or B

**B, and for a stronger reason than convenience.**

The "never reinstall" rule is not really about saving a trip to the office. It is
about **version skew**.

- Put the parser inside the `.exe`, and a parser fix does not take effect until
  somebody replaces the file on that PC
- In the gap, **some files are parsed by the old version and some by the new**.
  Both write the same rows under the same key, and whichever ran last wins. The
  ERP has no way to tell which parser produced a row
- We have just lived through exactly this class of problem. The `vch_no` key bug
  was a parser bug, and its damage was silent. Version skew is the same kind of
  wrongness: nothing looks broken, the numbers are just quietly wrong

With **B the `.exe` copies bytes.** It has no version-dependent behaviour at all.
That is the property that makes "new accountant, new PC, new version of Busy"
safe — not tidiness.

**A second point against A:** it ties *two* moving parts to that PC, not one.
Your parser, and `access-parser` itself. A bug fix in the library would also need
a reinstall.

**The argument for A is thinner than it looks.** "No `.bds` leaves the office" is
true of the container file only — the contents end up in the same Supabase
either way. It avoids shipping the file, not the data.

So: **B for the daily sync.** Now that mdbtools is out of the picture, B is a
few lines of Python on anything cheap, and the rule stays intact.

### One small thing worth adding when you build it

Record the parser version on each batch — `busy_import_batches.parser_version`.
Then if a row ever looks wrong, you can tell which parser produced it. It is one
column and it makes skew visible if it ever happens anyway. I have not built it,
since it is your call and the parser is yours.

---

## Where things stand

**Ready and waiting on nothing:**
- The upload screen, the guard, the red warning, the setup instructions, the
  `app-downloads` bucket — all unchanged and all correct
- The database, end to end

**Waiting on you:**
1. **The rows file** from the updated parser — then the history loads today
2. **The `.exe`**, built on any Windows machine from `busy/uploader/`
3. **The small Python service** for the daily sync, whenever it suits — the
   uploader already posts to whatever address is in its `config.txt`

**One thing to decide:** `parse_service_url` is now dead. Say the word and it
goes, along with the old `extreme_rate_threshold` from Phase 2.
