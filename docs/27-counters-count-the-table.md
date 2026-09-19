# The counters read zero on a full table — what was wrong and what changed

Raghbir was told to check the 98,644-row load against three numbers on the Load
history screen. All three read **zero** while `busy_history` held every row.

> "A number whose only job is to tell me whether the load worked, and which
> reads zero on a full table, is worse than no number at all."

He is right, and it is worse than that: had the load really failed, the screen
would have said exactly the same thing.

---

## First, the load. It is right.

Counted from `busy_history` itself, live, as the signed-in owner:

| | Expected | Counted | |
|---|---|---|---|
| item REF | 21,470 | **21,470** | matches |
| item RS | 1,432 | **1,432** | matches |
| ledger REF | 67,763 | **67,763** | matches |
| ledger RS | 6,532 | **6,532** | matches |
| opening REF | 1,065 | **1,065** | matches |
| opening RS | 382 | **382** | matches |
| **TOTAL** | **98,644** | **98,644** | **matches** |

Six figures out of six, and the total added up from them rather than counted
separately. The load is done.

---

## Why the counters read zero — and it is not what it looked like

Raghbir's reading was that they count batches, and every batch is superseded,
so they count nothing. **That is not what they were doing.** They read
`busy_history_ref` and `busy_history_rs`, which are views over `busy_history`,
with `count(*)`. That is counting the table.

They read zero because **the read was refused, and the screen wrote the
refusal down as a number**.

`busy_history` has a row-level policy letting a signed-in person with
`busy_data.view` read it. The `SELECT` grant that policy needs **was never
given**. Row-level security decides which rows you may see; the grant decides
whether you may reach the table at all. Without the grant the read is refused
before the policy is ever consulted. Both views are `security_invoker`, so they
inherit that refusal, and every signed-in person — Raghbir included — got
`permission denied for table busy_history`.

Then this line finished the job:

```js
return sel.then(function (r) { return r.count || 0; });
```

A refused read has no count. `null || 0` is `0`. The screen printed 0.

**So his conclusion was right and the reason was different.** The number could
not be trusted, and it would have read zero on a real failure too — he would
not have been able to tell the difference. That is the part that mattered.

---

## What changed

### 1. The grant that was missing

`grant select on public.busy_history to authenticated`. The policy that was
written is now the policy that runs, and the two views work for the people they
were built for. Checked afterwards: a signed-in person with no Busy permission
sees **0 rows** from every Busy table, which is the rule working rather than
the rule being unreachable.

### 2. The counts come from the rows, by company and kind

`busy_row_counts()` counts `busy_history` itself and returns every company and
kind beside what is expected. No batch record is asked whether it finished.

The **total is never stored**. It is added up from the parts on the screen, so
it cannot disagree with the tiles above it. That is convention 6 in `docs/12` —
balances are derived from the documents, never typed in — applied to a count.

### 3. The expected figures moved into a table

Three columns on the settings row could not hold six figures, and
`kind='opening'` arrived this month — the next new kind would have needed
another migration. `busy_expected_rows` is keyed by company and kind, so a new
kind is a row, not a schema change. The figures there are typed in, because
they come from Busy; the counts they are compared against never are.

### 4. A failed call is never turned into a number

If the count cannot be read, the tiles show **nothing** and say what went
wrong, in red. Tested by making the call fail on purpose and proving no digit
appears on screen.

---

## The audit: every other number on a screen

The question asked of each one: **is it counting the thing, or counting a
record about the thing?**

| Number | Comes from | Verdict |
|---|---|---|
| Load history counters | was: views over `busy_history`, refused → 0 | **fixed** — now `busy_row_counts()` over the rows |
| Price History row count and pager | `busy_search_count`, `count(*)` over `busy_history` | counts the thing |
| Rows per financial year | `busy_fy_status`, a `count(*)` subquery per year | counts the thing |
| Deleted-in-Busy rows | `busy_deleted_rows`, the rows themselves | counts the thing |
| Monthly totals, year-on-year, GST | `busy_monthly_totals` / `busy_gst_ledger`, summed from `busy_history` | counts the thing |
| Clear preview ("this will remove N") | `busy_clear_preview`, `count(*)` over `busy_history` | counts the thing |
| "added N, changed N, marked gone N" after an import | the import's own return, counted as it wrote | counts the thing |
| Failed syncs in the last 7 days | `busy_last_sync`, counts **batches** | correct — it is reporting on syncs, not on rows |
| Pending approvals, employees, vendors, salary sheets, holidays (admin) | `.length` of the list being rendered | counts the thing |
| Payroll totals | summed from the entries on the sheet | derived, never stored |

**One number was wrong. It was the one he was told to check the load against.**

### But the shape underneath it was in three places

A call that fails, turned into a number or an empty list:

| Written as | Read on screen as | Actually meant | Now |
|---|---|---|---|
| `r.count \|\| 0` | `0` | the read was refused | says what failed, shows nothing |
| `r.live_rows \|\| 0` | `0 rows this year` | the field never arrived | shows `—` |
| `(res.success && res.requests) \|\| []` | `Nothing pending right now.` | the call failed | says so, in red |

That third one is in `admin.html`, and it was put there by an earlier fix of
mine: a reply with no list used to crash the screen, and I stopped the crash by
treating a failure as an empty list. It stopped crashing and started lying.

---

## The set check, run once across the whole database

If one table had a policy with no grant, how many others did? `88 tables`
asked at once — the answer is in `tests/check-rls-grants.sql`, and it found
four more, in two different shapes:

| Table | What was true | What it meant |
|---|---|---|
| `busy_history_changes` | no row security at all, granted | **every signed-in person could read the old and new value of every Busy row that changed** — the prices and parties `busy_history` protects |
| `busy_financial_years` | no row security at all, granted | the years each firm has, readable past the permission check on the view above it |
| `job_secrets` | granted, no policy | not a leak — nothing could come back — but a grant that says nothing |
| `busy_import_staging` | granted, no policy | the same |

The first two now carry the same policy `busy_history` has, the one Raghbir
already agreed: `busy_data.view`, or the owner. The last two had the pointless
grant removed. **88 of 88 tables are now reachable on purpose.**

---

## Keyboard movement in the result table

Read-only data, so the keys are for reading and copying. Nothing is editable —
Enter and Tab **move**, they never open a cell.

| Key | What it does |
|---|---|
| Enter | next cell to the right. At the END of a row, the FIRST cell of the next row |
| Tab | the same as Enter |
| Shift + Tab | back one cell. At the START of a row, the LAST cell of the row above |

The two real ends stop rather than wrap: the last cell of the last row stays
put, and so does the first cell of the first row. Wrapping round would lose the
person's place.

**The trap here, and it was tested for:** registering Tab as a table key is one
line away from breaking every form on the screen. There is a test that focuses
the search box, presses Tab, and proves the focus still moves to the next
control.

This is now a standing rule for **every result table in the ERP** — `docs/23`,
section 5f.

---

## Tested

- `sh tests/run-all.sh` — **202 of 202** on busy.html, **28 of 28** on the
  permission screen, 5 pages agreeing, no test reading a cell by position.
- **25 of 25** database call sites resolve against the project itself.
- **88 of 88** tables reachable on purpose.
- New tests: the counts are asked of the rows; every company and kind gets its
  own counter; the total is added up and matches; a short load says how short
  as a number; **a refused read shows no digit at all and says what failed**;
  Enter, Tab and Shift+Tab move and wrap at row ends; both table ends stop;
  Tab still walks the controls outside the table; nothing in the table is
  editable.
