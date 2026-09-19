# A phone layout of its own, not the desk squeezed

> "It works, but nobody would choose to use it."

The menu was the way in. This is the screens themselves.

---

## A table is not a table on a phone

Eight columns across 390px is unreadable however it is squeezed. Below the
breakpoint **the table is not on the screen at all**. A row becomes a card:

```
AGGARWAL STEELS                          1 Jan 2025
MS PIPE 80X40X2.5
billed as one job                        ₹81,296.27
```

- **who and when** on the first line, the party at 15px
- **what** on the second
- **how the amount was reached, and the amount**, right-aligned at 16px, so
  the eye can run down a column of them
- **everything else behind a tap** — type, voucher number, year, qty, rate,
  the extreme-rate warning, the full description, and which kind of match it
  was when searching

Three lines. Several fit on one screen without scrolling.

**One thing the tests could not have caught.** The first build had the cards
rendering *underneath* the desktop table — every assertion passed, and it was
obvious the moment I looked at a screenshot. `.rc-list` now starts at
`display:none` and only the media query turns it on.

**And a small thing worth keeping:** the description is dropped when it only
repeats the item. `MS PIPE 80X40X2.5 · SIZE MS PIPE 80X40X2.5` is one fact
printed twice, and on a phone that is a whole line wasted.

## Filters behind a button

They take the whole width and there is no room for them beside anything. So a
**Filters** button carrying the number that are on, opening a panel over the
screen: dates side by side on their own row, the voucher tickboxes in an even
two-column grid, rows-per-page, and **Clear all / Apply** at the bottom. It
closes on Apply, on the ×, on Escape, and on a tap outside.

The controls are **moved** into the panel, not copied. Two sets of the same
inputs is two things to keep in step, and the one nobody is looking at drifts.
Moving the real nodes also means every piece of wiring already written — the
date shortcuts, the chip handler, the page-size listener — keeps working
untouched.

## The rest of it

- The **search box gets the full width**; the placeholder is shortened so it
  no longer gets cut off mid-word
- **Pagination**: where you are on its own line, then Previous and Next at
  175×48 each
- The **Columns** control is gone below the breakpoint — it chooses what a
  table shows, and there is no table
- **Back to ERP** is gone too: the menu reaches the whole ERP from every page
  now, and it was taking room the title needed
- Nothing scrolls sideways, and nothing was shrunk to fit

## Approvals

The km-tracker rows already stacked on a phone, but stacking a table is not
laying out a card: it was Employee / Date / Vehicle / Morning / Evening / KM /
Cost / Status one under another, every one with its heading, the desk table's
column rules showing through as stray vertical lines, and "Approve" breaking
across two lines inside its own button.

Now: who and when on one line, the vehicle under it, KM and Cost as a pair,
the two readings a line each — squeezed into half the width, `41250` wrapped
to `412 / 50` — the status, then Approve and Reject full width at 46px.

The top bar was cramped too: the subtitle took three lines, the name was cut
to "Raghbir …" and Log out wrapped. On a phone the screen's name and the way
out are what matter; the sentence explaining the screen is a desk thing.

## What is NOT done, and why

**Ledgers.** You named four screens that matter on a phone. Three are done —
Price History, Challans (the same screen) and approvals. **The ledger screen
does not exist yet.** It was agreed as buildable after the opening balances
landed and has not been started. It is not a phone problem and I have not
pretended otherwise.

## The desktop did not move

Checked at 1360px in the same run: the table is what is on screen and the
cards are not, all eleven columns are there, the filters are back in the bar,
the Columns control is back, Back to ERP is back, the headings still stay put
while the rows scroll under them, and the menu is still a column down the
left.

## Tested by looking at it

At **390px**, in Chromium, with screenshots read rather than assertions
counted. That is how the cards-under-the-table fault was found, and the
repeated description, and the cut-off placeholder, and "Approv / e".

| | |
|---|---|
| `tests/phone.test.js` | **102 of 102** — now covers the card layout, the filter panel, the search width and the desk-width check |
| `tests/cold-open.test.js` | 108 of 108 |
| `tests/nav.test.js` | 46 of 46 |
| `tests/busy.test.js` | 209 of 209 |
| `tests/admin-permissions.test.js` | 28 of 28 |

## Also settled

**HRMS stays as its own module**, with Km Tracker, Salary Calculator and
Loans & Advances inside it. Written into `docs/11` as decided rather than as
an open question.
