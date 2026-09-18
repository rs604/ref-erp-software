# Screen tests — what every screen must pass before it is called done

**Date:** 17 Sep 2026

**Why this exists.** Raghbir clicked a permission checkbox. It ticked, and the
page jumped back to the top. He clicked another. Same thing. Nothing was broken,
nothing errored, and no build report would ever have mentioned it.

Testing every screen by hand would take him two to three months. Most of these
faults are machine-detectable, so they should be machine-detected.

**The rule: no screen is reported done until these have been run and the result
stated.** Not "it works" — the list, with what passed and what did not.

---

## How to test them

Drive a real browser. Before each action, record the page state. After it,
compare.

State worth recording before every single action:

- scroll position
- which element has focus
- which popups are open
- the value of every field on the screen
- the URL

Then do the action, record it again, and compare against what the rule expects.

---

## 1. NOTHING MOVES THAT SHOULD NOT

**Raghbir's actual bug.** Run this against every clickable thing on the screen —
every checkbox, every tick, every row, every chevron, every add and remove button.

| After the action | Expected |
|---|---|
| Scroll position | **UNCHANGED**, unless the action was meant to navigate |
| Focus | Still on what was clicked, or the next field |
| Open popups | Still open. Nothing closes itself |
| Other fields | Every value still there. Nothing wiped |
| The thing clicked | Actually changed |

**The usual cause:** the whole list redraws after each change and the browser
forgets the position. Redraw only the row that changed.

**Report as:** `clicked 61 checkboxes · 61 kept scroll · 0 moved`

---

## 1b. THE SCREEN HAS TO SPEAK TO THE PERSON USING IT

Two rules, both learned the same way: the screen knew something and did not say
it.

### A screen must never spin for ever

| State | Expected |
|---|---|
| Something is loading | Say so, and say what |
| It is taking more than a few seconds | **Say that too.** A person cannot tell a slow screen from a broken one, and will sit looking at either |
| It failed | Say **what** failed, in plain words, and offer a way out — try again, or go back |
| It finished with nothing | Say what nothing means here, and what to do about it. *"No history loaded yet — use Load history"*, not a blank table |
| Before the sign-in check returns | **Something must already be on the screen.** A page that is `display:none` until a call returns is a white page with no end |

A spinner with no end tells the person nothing at all. Every load ends one of
three ways — rows, nothing, or a fault — and each of the three has to be said
out loud.

**Watch the synchronous throw.** `something().then(...).catch(...)` cannot catch
a `something()` that throws *before* returning its promise. The catch was never
attached. That is how a page ends up blank with an uncaught error nobody sees.

**Report as:** `every load ends in words · 6 of 6 guarded · slow after 8s says so`

### A rule that only exists in a comment protects nobody

**Every rule we have decided must be findable on the screen where it matters,
not only in the code.** A comment protects the person who wrote it. The person
using the screen cannot see it.

If the code says *"a batch must hold the whole year or the rest is marked
deleted"*, the screen says it too, next to the button that does it. If a year
can never be corrected once frozen, the screen says why. If a rate is flagged,
the screen says what it was measured against.

Test it by reading the screen's own words back: every rule that could cost
somebody real money should be findable without opening a file.

**Report as:** `4 rules that matter · 4 stated on screen · 0 only in comments`

---

## 2. THE KEYBOARD

Every form. Every one of these.

| Key | Expected |
|---|---|
| Enter | Moves to the next field. **Never saves** |
| Tab | Moves to the next field |
| Shift+Tab | Moves back |
| Esc on an unchanged form | Leaves immediately, no popup |
| Esc on a changed form | Popup: save as draft · discard · cancel |
| Esc with a popup open | Closes the popup only, not the form |
| F2 | Saves |
| Ctrl+D | Saves as draft |
| Ctrl+/ | Opens the shortcut list |
| Enter on a multi-line field | **New line.** Does not move on |
| Enter on the last cell of a table row | Starts a new row |
| Arrow keys inside a table | Move between cells, like a spreadsheet |
| F6 | Deletes the row the cursor is on |

**Every date field, everywhere in the ERP:**

| Key | Expected |
|---|---|
| `T` | Puts today in |
| `Delete` | Empties the field |

Both go in the field's tooltip, so they are findable without being taught.
Dates get typed dozens of times a day, and reaching for the mouse to empty one
is the friction that makes people stop using a system.

`Esc` is deliberately **not** a date key. On a screen where Esc already clears
a search box, one key doing two different jobs depending on where the cursor
happens to be is how people learn not to trust a key.

**Also:**

- Focus lands in the first field, or the search box, when the screen opens.
  Nobody should have to click to start typing
- Tab order follows the visual order. No jumping from column 3 back to column 1
- Every dropdown filters as you type. Enter picks and moves on
- No trap: Tab from the last field must reach the buttons, not loop

**Report as:** `14 keyboard rules · 13 passed · Enter saved the form on the
vendor screen`

---

## 3. WHAT IS MANDATORY IS ACTUALLY MANDATORY

- Save with a mandatory field empty → **blocked**, and the field shows red
- The message says what is missing, in plain words
- **Never the word "error"** for something merely incomplete.
  *"HSN 8414 has 4 digits. Your setting requires 6."*
- Fixing it clears the red without needing a reload
- Fields that do not apply are **absent**, not greyed. Aadhaar on a company
  vendor, mounting on a worm gear box

---

## 4. WHAT IS BLOCKED IS ACTUALLY BLOCKED

Test the real rules, not just the form:

- A duplicate GSTIN, mobile, landline or bank account → refused, **and the block
  names the holder**
- A bill rate different from the PO rate → refused
- A quantity outside the item's tolerance → refused unless approved
- A fully billed PO → refused, naming the existing invoice
- A drawing sent with no file → refused
- Whoever raised a PO cannot approve it
- A follow-up dated after delivery → refused

**Each of these is a rule someone spent time deciding. If it is not enforced,
the deciding was wasted.**

---

## 5. THE LIST SCREENS

- Focus lands in the search box on open
- Search covers the whole database, not the page on screen
- Exact matches highlight the typed letters. Fuzzy matches shade the whole row
- **A fuzzy match is never presented as an exact one**
- Filter chips show real counts
- Pagination works, and the choice is remembered
- **All** does not freeze the browser on 4,000 rows
- Ctrl+Up reaches the top, Ctrl+Down the bottom
- Sorting a column keeps the filters
- An empty result says something useful, not a blank screen

---

## 5b. EVERY RESULT TABLE WORKS LIKE A SPREADSHEET

Anyone who works in Excel all day reaches for the arrow keys without thinking.
Every table of results in the ERP answers them.

| Key | Expected |
|---|---|
| Click a cell | It is selected — a **visible border, never a fill** |
| Arrow keys | Move the selection one cell left, right, up, down |
| `Home` / `End` | First and last cell of the row |
| `Ctrl+Up` / `Ctrl+Down` | Top and bottom of the table |
| `Ctrl+C` | Copies the selected cell, and says so |

**Nothing in a result table is editable.** Selection is for reading and
copying. A table that shows what was, rather than what is being decided, is
read only, and no key in it may change a value.

A border rather than a fill, because a fill fights the row colours and the
search highlight, and reads as *this cell is different* rather than *this cell
is where you are*.

**Report as:** `selection · arrows · Home/End · Ctrl+Up/Down · Ctrl+C — 5 of 5`

---

## 5c. NEVER FIND A CELL BY COUNTING

This is a rule for the **tests**, not the screens, and it earned its place.

A test read the Amount column as `td[10]`. The moment a column was hidden it
was reading Rate instead, and reported every row as having no amount at all.
Nothing was wrong with the screen. The test was counting.

Columns can be turned on and off, so columns will keep moving:

```js
const at = name => heads.indexOf(name);
td[at('Amount')]                               // not td[10]
rows.find(r => r.innerText.includes('80X40'))  // not rows[1]
```

Position in a list of **equivalent** things — the third checkbox, the first
menu item — is fine. Indexing into the cells of a row is not.
`tests/check-no-positional-cells.js` runs on every test run and refuses both
`td[N]` and `tr:nth-child(N)`.

---

## 6. POPUPS

- Open one, then another from inside it. **Two deep works**
- Esc closes one level, not all of them
- The screen behind does not scroll or lose its state
- Coming back, the first popup is as it was left
- **Three deep is not allowed.** If a screen needs it, the design is wrong

---

## 7. NUMBERS AND MONEY

- Indian format everywhere: ₹1,50,000, never ₹150,000
- Dates read 15 Sep 2026, never 09/15/26
- The days column is one signed number: `+9` overdue, `0` today, `−28` to go
- Totals are calculated, never typeable
- **A zero that means "not priced" never shows as ₹0.** It says why

---

## 8. AFTER SAVING

- **Scroll position and filters survive.** Saving row 40 of a list should not
  return you to row 1
- The saved change is visible without a reload
- Save twice quickly → one record, not two
- A failed save keeps everything typed. Nothing is lost

---

## 9. THE PHONE

Only for the screens genuinely used on one — raising a request, approving.

- Nothing needs a sideways scroll
- Tapping a field does not hide it behind the keyboard
- Buttons are big enough to hit
- **Approvals that need care stay desk-only.** A phone screen works against
  careful checking

---

## 10. PERMISSIONS ARE REAL

- Sign in as an ordinary worker: **cannot** see another person's salary or bank
  details
- Sign in as a supervisor: sees department attendance, **not** bank details
- Owner-only screens are **absent from the menu**, not greyed
- A screen reached by typing its address directly is still refused

---

## A CHANGE THAT SPANS TWO PLACES HAPPENS IN THREE STEPS

The database, the deployed pages and the deployed functions do not change at
the same instant. Whichever moves first, there is a window where the other one
is wrong — and in that window, real people hit real errors.

**Never remove the old shape in the same breath as adding the new one.**

| Step | What |
|---|---|
| 1 | Add the new shape. The old one keeps working |
| 2 | Ship the page or the function that uses the new shape, and wait for it to actually be everywhere |
| 3 | Only then remove the old shape |

This was reasoned about carefully for a permission-key rename, written down,
and then walked straight into a day later on a search function: the old
argument was dropped in the same migration that added the new one, and every
browser still holding the previous copy of the page broke instantly. The
database and the repository agreed with each other the whole time. What
disagreed was the database and the page already open on somebody's screen.

**A test cannot catch this one.** The repository was right, the database was
right, and every check passed. Only the order of the two deployments was
wrong. So it is a rule, not a test — and the test that goes with it is the
cheap one: after a change that spans two places, open the thing and click it.

---

## ANYTHING THAT BELONGS TO A SET GETS CHECKED AGAINST THE SET

Not once. **On every run.**

Three of these in a single day, and all the same fault:

| The thing | The set it belonged to | What it had drifted into |
|---|---|---|
| `busy.html` | the pages that sign a person in | no menu link, opened to nothing, and loaded the Supabase library from a different address at an unpinned version — so one day it did not load and the page refused to open |
| `hr-actions` | the code in the repository | deployed and running, six lines ahead of the repo copy, with nothing saying so |
| `zz-storage-cleanup` | the code in the repository | live in the project and not in the repo at all |

In every case **nothing was wrong with the thing itself**, and nothing was
wrong with the rest of the set. Only the gap between them was wrong, and a gap
belongs to nobody, so nobody was looking at it.

A set is anything where "they should all do this the same way" is true:

- the pages that sign a person in — same library, same version, same no-cache
  instructions, same build number, same reload check
- the code that is deployed, against the code in the repository
- the migration files, against the migrations the database has actually run
- the calls to a database function, against what that function takes

**Work out what the set is, then check membership automatically.** Do not keep
a list by hand — a hand-kept list is one more thing that drifts. Decide
membership from a property of the thing itself: `tests/check-page-set.js` calls
a page a member if it loads `app-config.js`, so a new page joins the set by
existing, and cannot be forgotten.

**Report as:** `5 pages · 7 shared things · all agree`

---

## THE PATTERN THIS PROJECT KEEPS FINDING

**Nobody is asking the wrong questions at the moment nobody is looking.**

Five times now, the same shape. Every one of them sat at a boundary — the
place where one thing hands over to another, which belongs to neither and so
gets checked by neither.

| What was measured | What was actually being measured |
|---|---|
| "every click moves the page" | the test driver scrolling to what it clicked |
| "the tab order is broken" | a date box swallowing three Tabs of its own |
| "the screen draws 200 rows when asked for 25" | the stub ignoring the page size the screen sent |
| "nothing is shaded as a close match" | an empty search box, where nothing can be close |
| "most rows have no quantity" | a sample read as though it were the data |

And the same shape again in the code itself, not the tests: `busy_search` was
called with seven arguments when it takes eight, and it worked, because the
missing one had a default. A default was standing in for an argument nobody
meant to leave out. Nothing was wrong at either end — the caller looked fine,
the function looked fine. Only the join between them was wrong, and nothing
was looking at the join.

**So: test the test.** Before trusting a check that passes, break the thing on
purpose and watch the check fail. A check that has never failed has not been
shown to work — it has only been shown to be quiet. `tests/check-rpc-calls.js`
was verified this way: the argument was removed again, the check failed, the
argument was put back.

And when a boundary is found to be unguarded, guard it permanently rather than
fixing the one crossing of it.

---

## What to put in every build prompt from now on

> Before reporting a screen done, run the tests in `docs/23-screen-tests.md`
> against it in a real browser. Report the result as a list: what was tested,
> what passed, what did not. "It works" is not a report.
>
> Confirm something in the ERP actually reaches the screen. A page nothing links
> to is a page that does not exist.
>
> Where a fault could silently return, close it off so it cannot — a constraint,
> a unique index, a check. Making a fault impossible is worth more than fixing
> the one instance of it.

---

## What is left for Raghbir

Only "this feels clumsy" — a judgement no script can make.

**Ten minutes a screen, not three months**, because everything above has already
been checked.
