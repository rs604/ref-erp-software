# Busy Data screens — the test run, and the two faults it found

**Date:** 17 Sep 2026

Run against `busy.html` in a real Chromium browser, driven by real clicks and
real typing. Sections 1, 2, 3, 5, 7, 8 and 10 of `docs/23-screen-tests.md`.
Section 4 has no rules on this screen — it reads history, it does not enforce a
purchase rule.

**40 of 40 passed, after two real faults were fixed.**

---

## Section 1 — nothing moves that should not

```
changed 4 filters          · 4 kept scroll  · 0 moved
clicked 11 menu items      · 11 kept scroll and kept the search typed · 0 did not
loading a file             · kept the page where it was
```

Clean from the start. `busy.html` was written after the permission grid and does
not rebuild the world on every click, so it never had Raghbir's bug.

## Section 2 — the keyboard

```
PASS  the cursor is already in the search box when the screen opens
PASS  Enter in the search box searches, and saves nothing
PASS  Esc clears the search box
PASS  Tab follows the boxes across the screen, left to right
      docType -> from -> to -> pageSize -> goBtn
PASS  Tab from the last box reaches the button rather than looping back
PASS  Shift+Tab goes back
PASS  Ctrl+/ opens the shortcut list
```

## Section 5 — the list screen

```
PASS  the list fills the page size asked for (25)
PASS  the row count says there are more than are shown
PASS  "All" draws every row without freezing the browser (200 rows)
PASS  a close match is shaded, never shown as an exact one
PASS  the count says in words how many are close, not exact
PASS  an empty result explains itself instead of showing a blank screen
PASS  the search is asked of the database, not of the rows on screen
```

## Section 7 — numbers and money

```
PASS  money is in Indian format — ₹1,62,908.15, never ₹162,908.15
PASS  every amount carries the rupee sign and two decimals
PASS  dates read 1 Jan 2025, never 01/01/25          <- WAS FAILING
PASS  a zero rate that means "not priced" is not shown as ₹0 — it says why
PASS  an extreme rate is flagged against the usual rate, not hidden
```

## Sections 3 and 8 — the upload screen

```
PASS  Load is blocked until a file is chosen
PASS  the empty file list says so in plain words
PASS  the whole-year rule is stated on screen, not just in the code   <- WAS FAILING
PASS  the firm and the year are shown before anything is loaded
PASS  loading kept the page where it was
PASS  the result of the load is shown without a reload
PASS  the rows went up split by firm and year, as one whole year
PASS  the parser version travelled with the rows
PASS  an empty number was sent as nothing, not as an empty string
```

## Section 10 — permissions are real

```
PASS  typing the address directly does not let an ordinary worker in
PASS  the owner-only menu items are absent for anyone else, not greyed
```

---

## The two faults found, and fixed

### 1. Dates in the search table read 01/01/25

`dmy()` returned day/month/year in numbers. Section 7 says dates read
`15 Sep 2026`. A date written entirely in numbers has to be decoded, and half
the world decodes it the other way round — `01/02/25` is either 1 February or
2 January depending on who is reading. On a screen whose whole purpose is
settling what a price was and when, that is not a small thing.

What made it worth finding: **the rest of the same page was already correct.**
The deleted-rows screen and the years table both used month names. Only the
search table, the most-used table on the page, did not. Nobody would have
spotted the inconsistency by looking at one screen at a time.

Now `1 Jan 2025`, everywhere on the page.

### 2. The one rule that matters was only in a code comment

The upload code carries this comment:

> THE ONE RULE THAT MATTERS: a batch must hold the WHOLE year. The import marks
> anything missing from a batch as deleted, so sending half a year would mark
> the other half gone.

That is the most dangerous thing a person can do on this screen, and the screen
did not say it. It said the rows are "split into one batch per firm and year",
which describes what the machine does, not what the person must not do.

The screen now says it, in red, above the button:

> **Send a whole year at a time. Never part of one.** A year is compared against
> what you send, so anything missing from the batch is marked as deleted in
> Busy. Send half a year and the other half is marked gone. The rows are split
> into one batch per firm and year for you, so a file holding several years is
> safe — a file holding half of one is not.

A rule that only exists in a comment protects the person who wrote it, not the
person using the screen.

---

## Four faults in the test, not in the screen

Written down because the pattern keeps repeating: **reading the tool's own
behaviour as the thing being measured.** That is now four times on this project.

1. **A date box swallows three Tabs.** Day, month and year are separate segments
   inside one `<input type="date">`, so Tab lands on the same box three times
   running. The test read that as a broken tab order. It compares the order the
   boxes are reached in now, not the number of presses.
2. **The stub ignored the page size.** The screen sends `p_limit` to the
   database and draws what comes back. The stub handed back all 200 rows
   whatever was asked, and the screen was blamed for showing them. The stub
   honours `p_limit` and `p_offset` now, as the real function does.
3. **Shading was tested with an empty search box.** With nothing typed, every
   row is an equally good answer and none is a "close" match, so there was
   correctly nothing shaded.
4. **The menu count was my arithmetic.** Eleven items — four for REF, four for
   RS, three owner-only — not ten.

---

## What is not covered

- **Section 6, popups.** This page has none. Two-deep popup behaviour is
  untested until a screen has them.
- **Section 9, the phone.** Not run. `busy.html` has a mobile layout in its CSS
  but no phone-sized run has been done.
- **The `.bds` route.** Only the rows-file route was exercised, because the
  parse service is not deployed yet. What is proven is that a rows file is read
  in the browser, split by firm and year, and sent with its parser version
  attached.
- The data behind every test is invented. The screens were driven against a
  stub, never against the live project.
