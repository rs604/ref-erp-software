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

### A shortcut is tested by pressing it, and by proving the PAGE answered it

Not that the key was pressed. Not that a handler exists. **That the page
handled it and the browser did not.**

| What to record | Why |
|---|---|
| The page's handler fired | The key reached the page at all |
| `defaultPrevented` is true | The browser was stopped doing its own thing with it |
| The right thing happened on screen | A handler that fires and does nothing is not a shortcut |

Press it for real — `keyboard.press('Control+Slash')` — never a dispatched
`KeyboardEvent`. A dispatched event proves your own handler runs; it says
nothing about whether the browser would have taken the key first.

**One listener, in the capture phase**, for every key the ERP owns. Capture
runs before any handler on any element inside the page, so nothing closer to
the key can swallow it. Bubble-phase listeners scattered across a screen are
how a shortcut works in one box and not in another.

**An `alert()` is the browser's own panel.** It is drawn by the browser, titled
with the web address, and looks like nothing else in the ERP. Ctrl+/ opened one
for a week and read as the browser having stolen the key. The ERP's own
shortcut list is a panel on the page.

**Keys the browser will not give up** — never lock these to anything:
`F12` (developer tools), `F11` (full screen), `F1` (browser help), `Ctrl+N`,
`Ctrl+T`, `Ctrl+W`. `F6` moves focus into the browser's own toolbar on Windows
and is unreliable. Where a key cannot be caught on every machine, pick another
one rather than ship a shortcut that works on one desk and not the next.

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

## 5a. A PAGE SIZE IS NOT PAGINATION

`25 · 50 · 100 · All` lets somebody choose how many rows to look at. It does
not let them see row 51. That screen shipped looking complete, and the gap only
appeared when somebody tried to reach the second page.

Every list that can hold more rows than it shows has:

| Control | Expected |
|---|---|
| Previous | **Disabled** on the first page, never hidden |
| Where you are | `Page 2 of 8 · rows 26–50 of 200`. The total, not just the page |
| Next | **Disabled** on the last page, never hidden |
| Page Up / Page Down | The same two moves from the keyboard |
| A new search | Goes back to page 1. Never strands somebody on a page that no longer exists |
| Changing the page size | Also page 1 — it is a different list |

Disabled rather than hidden, so where you are is always on the screen. A
control that disappears at the edge leaves the reader guessing whether there
is more.

**Test it by actually reaching page 2**, and by reading which rows arrived. A
pager that draws the right numbers and fetches the same rows is not a pager.
Check the offset the database was asked for, not only what the screen drew.

**Report as:** `page 1 started at V1000, page 2 at V1025 · offset 25 · Page 8 of 8 reachable`

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

## 5d. A COUNT TYPED INTO A TEST GOES STALE

The sister of 5c, and it cost a red run the day the Match column was added.

```js
record(`every column can be turned on or off (${boxes} of them)`, boxes === 11);
```

Eleven was right when it was written. The twelfth column made it wrong, and the
test then failed for a reason that had nothing to do with what it was testing.
Worse, a count like this can go the other way: it passes while the thing it
claims to check has quietly gone missing, because the number still matches.

**Measure the count against the thing itself.** Turn every tickbox on, then
count the headings:

```js
const boxes = await p.locator('#colList input').count();
for (let i = 0; i < boxes; i++) await p.locator('#colList input').nth(i).check();
record('every column can be turned on or off', boxes === (await headOf()).length);
```

Now the test says what it means — one tickbox per column, no column without one
— and a thirteenth column joins by existing.

**Careful:** replacing the number with something that is trivially equal is
worse than the number, because it looks like a check and is not. Counting the
tickboxes and then comparing that with the labels beside the same tickboxes
proves nothing. Compare across the two sides of the thing you are testing.

---

## 5e. A GUESS IS NEVER SHOWN AS A HIT

A search that guesses must say, on every row, that it guessed.

Price History answers in four layers, and the row carries which layer answered:

| Layer | Shown as | What it means |
|---|---|---|
| 1 | Exact | the words appear as typed |
| 2 | Spacing | the same words, different spacing or punctuation |
| 3 | Spelling | a close spelling — **a guess** |
| 4 | Split | words typed run together — **a guess** |

Layers 3 and 4 are tinted as well as labelled, and the line under the table
says how many of the rows on screen are guesses. Nothing typed means no label
at all: with no search there is nothing to be right or wrong about, and a row
that says "Exact" when nothing was typed is a lie that costs nothing until the
day somebody believes it.

**The rule under it:** numbers and codes match exactly, always. Fuzzy applies
to words, never to digits. 80X40X2.5 and 80X40X3 are different pipes, and no
layer of guessing is allowed to blur them.

**Report as:** `Exact · Spacing · Spelling · Split · nothing typed = no label`

---

## 5f. KEYBOARD MOVEMENT IN A RESULT TABLE

**Every result table in the ERP, not just Price History.** The data is
read-only, so the keys are for reading and copying, never for editing.

| Key | What it does |
|---|---|
| Arrow keys | one cell in that direction, stopping at the edges |
| **Enter** | next cell to the right. At the END of a row, the FIRST cell of the next row |
| **Tab** | the same as Enter |
| **Shift + Tab** | back one cell. At the START of a row, the LAST cell of the row above |
| Home / End | first / last cell of the row |
| Ctrl + ↑ / ↓ | first / last row |
| Ctrl + C | copy the selected cell |

The end of a row is not the end of the reading, which is why Enter and Tab
carry on to the next row. The two real ends — the first cell of the first row
and the last cell of the last row — stop. They do not wrap round to the other
end of the table, because that loses the person's place.

**Two things to prove every time:**

1. **Nothing is editable.** No `input`, no `textarea`, no `contenteditable`,
   anywhere in the table body. Enter and Tab move; they never open a cell.
2. **Tab still works outside the table.** Registering Tab as a table key is
   one line away from breaking every form on the screen. Focus a field that is
   not in the table, press Tab, and prove the focus moved on.

**Report as:** `Enter · Tab · Shift+Tab · wraps at both row ends · stops at
both table ends · Tab still walks the controls outside`

---

## 5g. A NUMBER THAT REPORTS SUCCESS MUST COUNT THE THING

The Load history counters read **zero** while `busy_history` held 98,644 rows.
Raghbir had been told to check the load against those numbers. Zero on a full
table is worse than no number at all: had the load really failed, he could not
have told the difference.

The first version of this rule was "never count records", and that is too
wide. The employee count on the HR screen counts employee rows, and the
employee row **is** the thing. Nothing is wrong with it.

**The rule is narrower and more useful:**

> **If a number's job is to tell you whether something WORKED, it must count
> the thing, not a record about the thing.**

The counters that lied were answering *"did the load work"* by counting
batches. The question was about rows; the answer came from batches. That is
the fault, and it is the only one worth hunting.

### So check every number that reports SUCCESS, COMPLETENESS or STATE

And leave alone every number that simply counts what it says it counts.

| Number | Reports | Answers from | |
|---|---|---|---|
| Load history counters | did the load work | **was** views over `busy_history`, refused → 0 | **fixed** — `busy_row_counts()` over the rows |
| rows per financial year | is this year complete | `count(*)` over `busy_history` | the thing |
| clear preview, "this will remove N" | what is about to happen | `count(*)` over `busy_history` | the thing |
| "added N, changed N, marked gone N" | did the import work | counted as the import wrote them, and the counters refresh straight after | the thing |
| last checked against Busy | when a sync last finished | a batch record | **the sync IS the thing** — but the wording had to say so; "as at 1:05 pm" read as "the rows are current to then" |
| failed syncs in the last 7 days | is syncing healthy | batch records | the sync IS the thing |
| year is "frozen" | is this year still compared | batch timestamps | the sync IS the thing |
| uploader version | what is installed on that PC | a typed-in setting | it cannot be observed from here, so the screen says it is typed in |
| expected row counts | what Busy should hold | typed in, from Busy | correct — this is the target, not the measurement |
| price history row count and pager | how many match | `count(*)` over `busy_history` | counts what it says |
| employees, vendors, approvals, salary sheets, holidays | how many | `.length` of the list being shown | counts what it says |
| payroll totals, monthly totals, GST | how much | summed from the rows | counts what it says |

**One number was wrong.** It was the one he had been told to check the load
against.

### And the fault underneath it, which is the more common one

`busy_history` had a read policy for `authenticated` and **no SELECT grant
behind it**, so every read was refused before the policy was ever consulted.
The screen then wrote:

```js
return sel.then(function (r) { return r.count || 0; });   // a refusal becomes 0
```

**A call that fails is never turned into a number, a zero, or an empty list.**
Four shapes of the same lie, all found on these passes:

| Written as | Reads on screen as | Actually means |
|---|---|---|
| `r.count \|\| 0` | `0` | the read was refused |
| `r.live_rows \|\| 0` | `0 rows this year` | the field never arrived |
| `(res.success && res.requests) \|\| []` | `Nothing pending right now.` | the call failed |
| `res.entries.filter(...)` | a blank screen, no message | the reply left the list out |

The last one is the opposite failure and just as bad: three screens threw and
showed nothing at all. An **absent** list is a broken reply, not an empty one.
Say which it was, in red, and show no number.

`tests/check-rls-grants.sql` asks the grant question of every table at once —
a read policy with no grant, a grant with no policy, and no row security at
all. Run it after any migration that adds a table, a policy or a view.

**Report as:** `88 tables · all reachable on purpose`

---

## 5h. A FILTER SAYS WHAT IT LEFT OUT

A row with no date cannot satisfy "on or after 1 April". Postgres is right to
drop it — null is not less than, not greater than, and not equal to anything.
But the total then quietly excludes rows that exist, and nothing says so.
Same family as 5g: the number is not wrong, the **silence** is.

So a filtered screen asks a second question with the same filters — how many
rows match everything except the filter, and have nothing to filter on? — and
says so in words:

> `3,411 rows found · 5 rows have no date and are not included in this range`

Asked only when a filter is actually set, because with no filter nothing is
being left out and there is nothing to claim.

### And what is missing is SHOWN as missing, never as blank

A blank cell reads as "nobody has filled this in yet". `no date in Busy` and
`no number in Busy` read as what they are: **this is what came out of Busy**.
Five Credit Note rows in the real data carry no voucher number.

**Never guess the value. Never hide the row.** A row that exists and cannot be
fully described is information about the source data, not a defect to tidy
away.

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

This section was three lines for months, and in that time the ERP shipped
with **no menu at all on a phone**. The left nav collapsed under 880px, which
was right, and nothing was ever built to bring it back. On a phone the ERP was
one screen and a Log out button, and no test said so.

### TEST IT AT A REAL PHONE WIDTH

**380 x 740, `isMobile`, `hasTouch`. Not a shrunk desktop window.** The faults
are different, and a narrow window will pass a page a phone cannot use:

| A shrunk window | A real phone |
|---|---|
| keeps the mouse, so hover still reveals things | there is no hover |
| keeps `click`, so a broken tap target still works | `tap` is what fires |
| does not match `isMobile` media features | it does |
| lets you see 30px buttons and think them fine | a thumb is 9mm across |

`tests/phone.test.js` runs the checklist below on every screen at that size.

### THE CHECKLIST — run it on every screen

1. **The menu opens and closes.** There is a hamburger, it is at least 44px,
   it slides the menu in **over** the page rather than pushing it sideways,
   and it closes on the backdrop, on Escape, **and on picking something** — a
   menu you have to close by hand is a menu covering the answer you just asked
   for.
2. **Every control is reachable and big enough to tap.** 44px minimum, both
   ways. Measured, not judged by eye: `Log out` was 68x28, `Add loan` 91x28,
   the clear-search x 20x21, the km-tracker sub-tabs 19px wide.
3. **Nothing overflows sideways.** The *page* never scrolls sideways. A wide
   table scrolling inside its own box does, and that is correct — so the check
   ignores anything inside an element that scrolls on purpose, and flags
   everything else.
4. **A form can be filled start to finish without the keyboard hiding a
   field.** Every field gets `scroll-margin-bottom` so the browser keeps room
   under it, and **16px text** so iOS does not zoom the page the moment it is
   tapped. 15.5px zooms; 16px does not.
5. **A table can be read.** It scrolls inside its own box, the page stays
   still, and the column headings stay put while the rows move under them.
   Prove the table is actually wider than the phone first, or the test passes
   on a table that never needed to scroll.

### A TABLE IS NOT A TABLE ON A PHONE

Eight columns across 390px is unreadable however it is squeezed. Below the
breakpoint the table is **not on the screen at all** — a row becomes a card:

```
HINDON METAFORMS PVT.LTD             16 Sep 2026
LIFT SHOE · 9 MM
2 × ₹3,000                                ₹6,000
```

- the two or three things that **identify** it, large enough to read at arm's
  length (15px and up)
- the **numbers that matter**, clearly, and **right-aligned** so the eye can
  run down a column of them
- **everything else behind a tap** — type, voucher number, year, the rate
  warning, the description in full

Three lines, not eight columns. Short enough that several fit on one screen.

**Both are in the page and only one is ever displayed.** The first build of
this left the cards rendering *underneath* the desktop table — invisible to
every assertion, obvious the moment anyone looked at it.

**Do not restack the table.** Employee / Date / Vehicle / Morning / Evening /
KM / Cost / Status one under another, each with its heading, is the table
turned sideways, not a card. Group it: who and when on one line, what on the
next, the numbers on the third, the buttons last.

### THE DESCRIPTION IS NEVER HIDDEN, ANYWHERE

The card showed `SKD CONVEYOR · ₹3,25,000`. The row's description said
**"Extension Charges of SKD Conveyor 38 Fee"** — an extension of an existing
conveyor by 38 feet, not a machine. The card dropped the description because
it *contained* the item name, on a rule meant to stop `MS PIPE 80X40X2.5 ·
SIZE MS PIPE 80X40X2.5` printing one fact twice.

Two rows from the real data settle it:

```
SKD (CYCLE ASSEMBLY CONVEYOR)   ₹6,65,000    (no description)
SKD (CYCLE ASSEMBLY CONVEYOR)  ₹12,00,000    130 FEET LENGTH
```

Without the second line those are the same item at two prices, and the pricing
looks inconsistent. With it, one of them is 130 feet long.

**The rule:** the description stays visible, collapsed or expanded, directly
under the item name and before anything a column would have held. Two lines
while the card is shut, all of it once it is open. **Never replaced, never
dropped.** The only thing dropped is a description that is *exactly* the item
written differently, letter for letter.

**And expanding must never take information away.** That is what happened
here: opening the card replaced the description with Type, Voucher, Year, Qty,
Rate and Match. Whatever is on the face of a card stays on the face of it.

`Match` was removed altogether. It says how the search engine matched, not
anything about the business, and the yellow tint already says the row is a
guess.

**Check the desk view for the same fault whenever a phone view hides
something** — that is where it is read most. Here it was clean: the
Description column wraps, is not clipped and holds the full text.

### FILTERS GO BEHIND A BUTTON

They take the whole width on a phone and there is no room for them beside
anything. So: a **Filters** button carrying **how many are on**, opening a
panel over the screen, with **Apply** and **Clear** at the bottom. It closes on
Apply, on the ×, on Escape, and on a tap outside.

**Move the controls into the panel, do not copy them.** Two sets of the same
inputs is two things to keep in step, and the one nobody is looking at drifts.
Moving the real nodes also means every piece of wiring already written keeps
working.

And: the search box gets the **full width** — it is the first thing anyone
uses. Date fields **side by side, alone on their row**. Pagination as
Previous · where you are · Next, each big enough to tap.

### THE HEADER PATTERN

Every screen with actions in its header breaks the same way on a phone. The
salary sheet printed its title **through** the hamburger, "Back", "Reset
Columns" and "Save Draft" — five controls fighting for one 390px row. PO
create, the vendor form, the item form and invoice entry would all have done
the same, because it is the pattern that is wrong, not the screen.

Below the breakpoint:

- the way out and the **title on the first line**, full width
- everything the screen can **do on the next line**, wrapping, each at least
  44px
- or the secondary actions behind a ⋮, leaving the primary one visible

Fix the pattern, not the two screens you happened to open.

### THE TAB PATTERN

Six tabs across 390px were squeezed until "Employee Category" printed through
"Relationship". Below the breakpoint a tab strip **scrolls sideways inside
itself** and the page stays still. One choice, used everywhere.

And **scroll the chosen tab into view**: a strip that scrolls can leave the
tab you just picked off the right-hand edge, with nothing on screen showing
which one is on.

### SOME SCREENS CANNOT WORK ON A PHONE, AND SHOULD SAY SO

A screen that needs a keyboard, a mouse and width is not improved by being
squeezed or turned into cards — it is made worse, and so is the desk version
that gets compromised for it.

Below the breakpoint, one plain line and nothing else:

> The salary sheet needs a computer. Open it on a desktop.

Desk-only so far: the **salary sheet** (a spreadsheet with arrow-key editing
and draggable columns) and **Who can do what** (61 permissions across five
columns per person, a grid that has to be read across).

### OVERLAP IS INVISIBLE TO EVERY OTHER CHECK

Nothing else in this folder catches it. Overlapping elements do not overflow
the page, are not too small, and are not unreadable in isolation — they are
just printed through each other. The check compares the boxes of every button,
link, tab and heading on screen against every other, skipping anything
off-screen or nested inside the other.

**Include elements that have children.** The first version of this check
skipped them, so it read the overprinted tabs — buttons with an icon and a
span inside — as clean.

### WHICH SCREENS MUST BE GOOD, AND WHICH MUST ONLY NOT BREAK

| | |
|---|---|
| **Good** | Price History · Ledgers · Challans · approvals. The ones opened standing on the shop floor or before a call |
| **Reflow without breaking** | everything else. Nobody builds a purchase order on a phone, and pretending otherwise would ruin the desktop screen |

### THE DESKTOP DOES NOT MOVE

Everything frozen in `docs/11` stays exactly as it is. This is a **separate
layout below the breakpoint**, not a compromise between the two. Every phone
change ships with a desk-width check that the table, the columns, the filters
in the bar and the Columns control are all still there.

### TEXT IS MADE BIGGER, NEVER SMALLER

**Do not shrink text to fit.** A screen that "works" at 10px is a screen that
cannot be read. Nothing under 12px, and anything a person actually reads —
table rows, field labels, messages — at 13px or more. If something does not
fit, it is the layout that gives way, not the reading.

### BE HONEST ABOUT WHICH SCREENS THESE ARE

| | What it has to be |
|---|---|
| **Used on a phone** — raising a material request, approving, looking up a past price, checking a ledger balance before a call | good, not merely functional |
| **Desk screens** — building a purchase order, the salary sheet, the permission grid | **reflow without breaking.** Nobody builds a PO on a phone, and pretending otherwise would ruin the desktop screen |

Both must pass the checklist. Only the first has to be pleasant.

**Approvals that need care stay desk-only.** A phone screen works against
careful checking, and that is a decision, not an oversight.

### ONE MENU, NOT TWO

Every page in the ERP opens its menu the same way, at the same width, with the
same markup. Busy Data used to turn its nav into a strip of items scrolling
sideways above the screen — workable, and a different thing from everywhere
else. A second way to reach the menu is a second thing to drift.

**Report as:** `86 of 86 at 380x740 · menu opens and closes on every page ·
nothing sideways · 44px everywhere · nothing under 12px`

---

## 10. PERMISSIONS ARE REAL

- Sign in as an ordinary worker: **cannot** see another person's salary or bank
  details
- Sign in as a supervisor: sees department attendance, **not** bank details
- Owner-only screens are **absent from the menu**, not greyed
- A screen reached by typing its address directly is still refused

---

## ABSENT OR GREYED — TWO DIFFERENT REASONS, TWO DIFFERENT ANSWERS

| Why it is not usable | What the menu does |
|---|---|
| **This person may not see it** | **absent.** A greyed row still tells them the screen exists, and who may see what is not their business |
| **It is not built yet** | **greyed, visible, not clickable.** Everyone sees it |

In Raghbir's words: *"A menu that grows a new item every week looks
unfinished; a menu that is complete with some items greyed looks like a
plan."*

Getting these the same way round is a real fault in both directions. Greying
a permission leaks what exists. Hiding an unbuilt screen hides the shape of
the ERP from the person paying for it.

---

## EVERY SCREEN CAN BE REACHED, AND CAN REACH BACK

Raghbir asked for the menu to work on a phone. There was no menu. Three of the
five pages had none at all, and the two that did could not reach each other's
screens.

He had been arriving at `admin.html` through a bookmark for weeks, so the ERP
looked navigable to the one person using it.

**The rule:**

> A screen that can be reached must be able to reach every other screen the
> person is allowed to open. On every page, at every width.

Tested by opening each page at 380px and **going to every other page through
the menu** — not by asserting a link exists. `tests/nav.test.js`.

And the menu is **one file**. Two menus is two lists to keep in step, and the
one nobody is looking at is the one that rots.

### The larger lesson, in his words

> "For weeks I have been using an ERP with no navigation and neither of us
> noticed, because I always arrived at admin.html through a bookmark. Worth
> asking what else is invisible because of how I happen to reach it."

**How you habitually reach a thing hides everything about reaching it any
other way.** The bookmark hid the missing menu. The desktop hid the phone. A
test that always signs in as the owner hides what a fitter sees; one that
always starts at the same screen hides what a cold arrival looks like.

So: for anything a person uses daily, ask **how else would somebody arrive at
this**, and try that way at least once. The answers so far —

| Habit | What it hid |
|---|---|
| a bookmark straight to `admin.html` | there was no navigation anywhere |
| a desktop browser | the phone had no menu, and 30px buttons |
| signing in as the owner in every test | what a fitter's menu contains |
| opening a screen from its own page | arriving at it from another page |

**Report as:** `5 pages · every page reaches every other · 380px and desk`

### A PAGE SWEEP DOES NOT SEE INSIDE A PAGE

`admin.html` holds nine screens behind one address. A screen that could only
be opened from inside another one would have exactly the fault the whole ERP
had — reachable only if you already knew the way — and no sweep of the five
pages would find it.

So the check is made against the page's own markup: every `view-*` in
`admin.html` must have an entry in the menu, and every menu entry must point
at a screen that exists. Both directions, because a menu pointing at nothing
is the same class of lie.

A form field that appears when a box is ticked is not a screen. Twenty-one of
those turned up on the first pass — bank details, MSME numbers, ESI and PF
fields, loan instalment fields — and they are correct: they belong to the form
they are in.

---

## DONE MEANS LIVE

Four rounds of work were reported **done** while sitting on a branch. The site
serves `main`. Raghbir opened his phone four times and saw none of it.

Every report ended with *"Not merged to main — say the word and I will"*, under
a heading that said done. That footnote was carrying weight it could not carry:
he read a delivery, I had filed a request.

**Two rules come out of it.**

### 1. Finished work is merged. Do not ask.

> "Never push to a branch other than the one you were given" is about not
> touching **other people's** branches. Merging your own finished work to main
> is the last step of the job, not a separate permission.

When it is done and tested, merge it and push it. If something is genuinely
risky to merge — a migration that needs a window, a change that wants his eyes
first — **say so and hold it**, in the blocking section, with the reason. The
default is that finished work goes live.

Six rounds of it sitting on a branch was worse than any merge would have been.

### 2. A report says what is LIVE.

Anything not live is **not done**, and belongs in a **BLOCKING** section at the
bottom of the report — never a footnote, never under a heading that says done.

### And the check that closes it

`tests/check-live.js` runs **last** in `tests/run-all.sh`. It asks GitHub what
`main` actually holds, compares it file by file with the repo, and reads main's
own bytes for the things that are supposed to be there **by name** — so a
failure says *"admin.html on main does not contain the hamburger"* rather than
*"files differ"*.

It cannot reach `erp.refconveyors.net`: this environment refuses that address
with a 403 on the CONNECT tunnel. It reads what GitHub Pages builds from
instead, which is `main`, and says so. Main can be minutes ahead of the CDN; it
is never behind.

**This is the boundary that was missing.** "Everything passed" can never again
mean "passed on a copy nobody visits."

**Report as:** `9 shipped files · what main serves is what is in the repo`

---

## OPEN EVERY PAGE COLD

> "A page I have never opened normally, that nobody has ever checked, sitting
> on a live site."

A **cold open** is a brand-new browser with nothing stored, arriving straight
at the address. Not a link from another page, not a tab that already has a
session. Run it at **380px and at desk width**, and **signed in and with no
session at all** — four openings per page.

This is the only check that sees what a stranger sees, and the only one that
sees a page nobody ever visits directly. It found three:

| Page | What a stranger actually saw |
|---|---|
| `admin.html` | **a blank white screen.** Nothing at all, while the redirect to sign-in happened — and for ever if it did not |
| `submit.html` | the whole odometer form, fields and all, rendered before the redirect |
| `reset.html` | a **"Set Your Password" form**. The server would have refused it, but inviting an action that cannot work is its own fault |

All three now say *"Taking you to the sign-in page… One moment."* from the
first paint, which is what `busy.html` already did.

**Three things to assert on a cold open with no session:**

1. The page **says what is happening**. A blank page is a failure, not a
   redirect in progress.
2. The working screen is **not rendered behind it**.
3. **No company data** appears anywhere on it.

**Report as:** `5 pages × 2 widths × signed in and not · 108 checks`

---

## IF THE INPUT CHANGES DURING AN INVESTIGATION, SAY SO

While one question was being investigated, the parser producing the data was
swapped underneath it. It happened to be harmless — both versions produced the
same 47,635 rows, which is the only reason the conclusion was safe — but that
was luck, not method.

**Whenever the thing being measured changes while you are measuring it, say so
before reporting a conclusion**, and say whether it could have affected the
answer. A conclusion drawn across two different inputs is two half-conclusions
unless somebody checks they agree.

This applies to the file being parsed, the code being tested, the database
being queried, and the page being clicked.

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
