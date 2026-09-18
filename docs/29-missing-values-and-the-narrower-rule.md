# What Busy did not give us, and the narrower rule for counts

## 1. The five rows — the count is right, two of the three details are not

> "THE FIVE UNDATED SALES INVOICE ROWS ... Show them, and mark them. Something
> like 'no date in Busy' in the date column."

Checked against the data before building anything:

| | |
|---|---|
| Item rows with **no date** | **0** |
| **Sales Invoice** rows with no date | **0** |
| Item rows with **no voucher number** | **5** |

The five rows are real. They are **Credit Notes**, and what they are missing
is the **voucher number**, not the date — every one of them has a date:

| Company | FY | Type | Date | Party | Item | Amount |
|---|---|---|---|---|---|---|
| REF | 2015-16 | Credit Note | 23 Oct 2015 | AVON ISPAT & POWER LIMITED | FOUR WHEEL TYPE OVERHEAD CONVEYOR | 37,600 |
| REF | 2016-17 | Credit Note | 1 Jul 2016 | MOONLIGHT TOOLS PVT. LTD | CONVEYOR WHEEL | 14,000 |
| REF | 2016-17 | Credit Note | 19 Jan 2017 | SIND ENGINEERING WORKS | BELT CONVEYOR | 14,145 |
| RS | 2018-19 | Credit Note | 15 Mar 2019 | ROCKMAN INDUSTRIES LIMITED | CFM BARREL TAIWAN MAKE | 24,500 |
| RS | 2023-24 | Credit Note | 15 Mar 2024 | MOMSTAR BIKES | REPAIRING CHARGES | 500 |

Because they all have dates, **they are not excluded by a date range**, so the
sentence "5 rows have no date and are not included in this range" would have
been false. Saying it would have been the exact fault this instruction exists
to prevent: a number on screen that cannot be trusted.

The only rows with no date are the **1,447 opening balances**, which are
undated by design and are never in price history — the scope is `kind='item'`.

### What was built instead — the principle, applied to what is actually missing

**Shown, and marked.** A blank cell reads as "nobody has filled this in yet".
These read as what they are:

- `no date in Busy` in the Date column
- `no number in Busy` in the Vch No column

In a quieter colour and in italics, so it reads as a note about the source
rather than as a value. Nothing is guessed. Nothing is hidden.

### And the mechanism you asked for, built and proved

A date range genuinely cannot hold a row with no date — null is not less than,
not greater than and not equal to anything, so Postgres drops it and the total
quietly shrinks. The screen now asks a second question with the same filters
and says the answer in words:

> `3,411 rows found · 5 rows have no date and are not included in this range`

Asked only when a range is actually set, because with no range nothing is
being left out.

**On today's data it reports zero**, and that is worth saying plainly rather
than letting a green test imply otherwise. It was proved by inserting an
undated item row inside a transaction and rolling it back:

| | |
|---|---|
| rows in range | 3,411 — **unchanged**, the undated row silently dropped |
| undated and left out | **1** |
| same, with a search that matches it | **1** |
| same, with a search that does not | **0** |
| with no range at all | 21,471 — the row is included |

It will matter for real on the ledger screen, where opening balances belong.

---

## 2. The narrower rule for counts

> "IF A NUMBER'S JOB IS TO TELL ME WHETHER SOMETHING WORKED, IT MUST COUNT THE
> THING, NOT A RECORD ABOUT THE THING."

That is a better rule than the one I wrote, and the reason is worth keeping:
"never count records" would have condemned the employee count on the HR
screen, where the employee row **is** the thing. The fault was never that a
record was counted. It was that **the question was about rows and the answer
came from batches**.

So the audit is now over numbers that report **success, completeness or
state**, and everything that simply counts what it says it counts is left
alone.

### Reports success, completeness or state

| Number | Answers from | |
|---|---|---|
| Load history counters | **was** views over `busy_history`, refused → 0 | **fixed** — counts the rows |
| rows per financial year | `count(*)` over `busy_history` | the thing |
| clear preview, "this will remove N" | `count(*)` over `busy_history` | the thing |
| "added N, changed N, marked gone N" | counted as the import wrote them, and the counters refresh straight after | the thing |
| failed syncs in the last 7 days | batch records | **the sync is the thing** |
| year is "frozen" | batch timestamps | the sync is the thing |
| "as at 1:05 pm, 17 Sept" | a batch record | the sync is the thing — **but the words were wrong** |
| uploader version | a typed-in setting | cannot be observed from here; the screen already says it is typed in |
| expected row counts | typed in, from Busy | correct — the target, not the measurement |

**One change came out of it.** "as at 1:05 pm, 17 Sept" invited a reading it
cannot support: that the rows are current to then. What it knows is that a
sync **finished** then. The source is right — a sync that was refused is
recorded as cancelled, not completed — but the words had to say which question
they were answering. It now reads **"last checked against Busy at 1:05 pm,
17 Sept"**, and the two failure cases read "never checked against Busy" and
"when it was last checked is not known".

### Simply counts what it says — left alone

Price history row count and pager · employees · vendors · pending approvals ·
salary sheets · holidays · payroll totals · monthly totals · GST. All of them
answer "how many" or "how much", and all of them count the rows they are
about.

---

## Tested

- `sh tests/run-all.sh` — **209 of 209** on Busy Data, **28 of 28** on the
  permission screen, **86 of 86** on the phone, 5 pages agreeing, no test
  reading a cell by position.
- **26 of 26** call sites resolve against the project itself.
- Migration 63 recovered from the ledger and **byte-identical** to the file in
  the repo.
- New tests: a row Busy could not fully describe is still shown; a missing
  voucher number says so rather than sitting blank; a missing date says so;
  a row that has both still shows the real values; with a range set the screen
  says how many rows it left out and asks that question with the same filters;
  with no range it claims nothing about undated rows.
