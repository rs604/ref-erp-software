# Two rows, and a list of our own

**Date:** 19 Sep 2026 · **Status:** live on main · No migration — screens and
two new shared files, `ui.css` and `ui.js`

Three faults on the ledger on a phone, and the instruction that mattered most
was the last one:

> Every report has these controls and every one has a party or item search.
> Fix both ONCE as shared components and apply them to all of them. Not screen
> by screen.

---

## 1 · The controls took the whole screen

Six rows before a single ledger entry: party, from, to, four range buttons
two-by-two, and two download buttons with the words spelled out. Now two:

```
PARTY
[ HINDON METAFORMS PVT.LTD            ]   [PDF] [XLS]
FROM            TO              RANGE
[ 04/01/2026 ]  [ 09/19/2026 ]  [ This FY      ▾ ]
```

- **The four range buttons are one dropdown** — This FY · Last FY · This month
  · All — and it shows which is chosen. It has a fifth entry the four buttons
  could not say: **Custom dates**. Typing a date of his own selects it, so the
  box no longer reads "This FY" over dates that are not this FY.
- **The downloads are icons**, 44×44, each with a tooltip and an aria-label.
  An icon with no name is a fault of its own; there is a test that both still
  say what they are.
- **The dates sit beside each other**, range after them, on one row.

**On a phone the calendar button had to go.** Three narrow controls on one row
leave it nowhere to sit but *on top of* the date, and it covered the last
digit: `09/19/2026` read as `09/19/202`. Below the breakpoint the button is
hidden — the field opens the picker on a phone with or without it. At a desk
it stays, where it is the only thing that says the field is a date.

Found by looking at the screenshot. Nothing failed.

---

## 2 · The list was the browser's, not ours

> Screenshot one: the list renders HALF TRANSPARENT, with the form behind it
> bleeding through the results… Screenshot two, the same search a moment
> later, renders solid. So it is intermittent.

The party search was a native `<input list="…">` with a `<datalist>`. **A
datalist cannot be styled at all** — the list that drops down belongs to the
browser and is not in the page. That is why it was see-through, why it was so
only sometimes, and why it had no hover, no selected row, no highlighted
letters, no ellipsis and no arrow keys. There was nothing to fix. There was
only something to replace.

`REFUI.pick()` — ours, in the page, in the ERP's palette:

- **Solid.** `var(--surface)`, always; a test asserts the computed background
  is opaque white and another asserts it lies *over* the form rather than
  pushing it down.
- A real shadow, and `z-index` above the card.
- **44px rows**, hover, and a selected state.
- **The typed letters lit up**, the same yellow as everywhere else. A word the
  search matched *fuzzily* is not in the label at all — "mottor" against HERO
  MOTORS — so nothing lights for it. The highlight says where the letters are,
  and there it has nothing to say.
- **Arrow keys move, Enter picks, Esc closes**, with `aria-activedescendant`.
- Long names truncate with an ellipsis, **over two lines**.

That last one is a change from what you asked for, and the reason is in the
picture. On one line, `HERO MOTORS LIMITED` and `HERO MOTORS LIMITED (DADRI)`
both came out as `HERO MOTORS LI…` — two different parties, one row of text,
no way to tell which was which. Two lines then the ellipsis still never runs
under the edge, and the part that distinguishes one name from another
survives. There is a test that two names differing only at the end do not
arrive as the same row.

The list also says **supplier** or **customer** beside each name, because the
placeholder promises "supplier or customer" and that is where it gets
answered.

### Two faults this turned up on the way

- **Escape did nothing in that box, and never had.** busy.html catches keys in
  the CAPTURE phase and stops Escape dead — so the new list could not be
  closed with it, and before that nothing else could either. The shortcut now
  asks `REFUI.closeOpen()` first: innermost thing on top closes first.
- **A row could only be chosen with a mouse.** The options answered
  `mousedown` and nothing else, so a keyboard activation or anything driving
  the page did nothing at all. `mousedown` now only holds the focus still;
  the choosing is on `click`, which a tap, a keyboard and a test all produce.
  The test found it on its first run.

---

## 3 · Then the space is used

At 380×740, with a party picked:

```
the control area is TWO rows, not six        2 declared, 2 on screen, 162px
all four cards are on the first screen       four cards end at 534 of 740
and the first ledger entry is on it too      first entry at 640 of 740
```

Measured, not eyeballed, and the measurement is an assertion now.

---

## Applied to all of them, not screen by screen

Two new shared files beside `theme.css` and `nav.js`:

| | |
|---|---|
| **`ui.css`** | the look: `.ctl`, `.ctl-row`, `.ctl-grow`, `.ctl-narrow`, `.ctl-acts`, `.icon-btn`, `.refpick*` |
| **`ui.js`** | the behaviour: `REFUI.pick`, `REFUI.icon`, `REFUI.light`, `REFUI.contains`, `REFUI.closeOpen` |

Both are loaded by all five pages and checked by `check-page-set.js` and
`check-live.js`. Where they are now:

| Screen | Control bar | Picker |
|---|---|---|
| Ledger | party · PDF · Excel · from · to · range | party names, from the server |
| Customers | customer | opens that customer |
| Items sold | item | opens that item |
| Material prices | the item search | replaces the wall of chips |
| Material panel | months-before · material share · other item | the other-item box |

The material search was twelve chips and "9 more — type another word to narrow
it", which was a list of names pretending not to be one. It is the same
dropdown now. The other-item box used to take the *first* match of whatever
was typed and report under that name without showing what else had matched;
it takes a picked name now.

**Vendor master is not on this list**, and that is deliberate: its search box
filters a table in place, which is a different thing from picking one row out
of several hundred. Turning it into a picker would be a change to how that
screen works, not a fix. Say the word and it is a small job.

### A trap this fell into first

`ui.js` began by appending its `<style>` to `<head>` on load — and a
stylesheet appended there comes **after** every page's own `<style>`, so at
equal specificity it wins. busy.html's phone rules for the control bar were
simply ignored and the Range dropdown fell to a third row, with nothing in
the tests to say so. A shared component must be *easier* to override than the
page it lands in, not harder. Hence `ui.css`, linked with `theme.css` before
the page. `check-page-set.js` now fails if either sheet is linked after a
page's `<style>`.

---

## The dead styles, deleted

> Dead styles get revived by someone who assumes they are there for a reason.

A scan of every class selector in both pages against every file in the repo
found fourteen with nothing using them. Thirteen were deleted, among them the
white-on-dark menu leftovers `.nav-item.level-2` and `.level-3`, an empty
rule, and `.pay-toolbar`, `.pg-wrap`, `.grid-scroll`, `.auth-brand`,
`.btn-block`, `.label-face`, `.nav-future-note`, `.rc-tap`.

The fourteenth was a **false positive, and a good one**: `.firm-RS` is built
at runtime as `'firm-chip firm-' + f`, so the scan could not see it and a
tool that deleted what it found would have taken the RS chip's colour away.
That is why the scan is not a gate — it is a thing to run and then read.

---

## What the tests hold

```
admin-permissions  28/28     nav       56/56
busy              231/231    phone    153/153
cold-open         108/108    sweep     50/50
check-live: 12 shipped files · what main serves is what is in the repo
```

phone.test.js gained twenty-three assertions for the control bar and the
picker; the sweep photographs the dropdown open, at viewport size.

Proved by breaking, and restored byte-exact (md5 checked):

```
FAIL  and it is SOLID — never see-through, which is the fault that started this
FAIL  busy.html links ui.css AFTER its own <style>, so the shared component
      outranks the page instead of the other way round
FAIL  the control area is TWO rows, not six
```

Also fixed while in there: the test stub used to answer with the whole fixture
whatever it was asked, so the first screenshot of the party dropdown showed
four names with no "hero" in them. It filters on `p_query` now, for the lookup
lists only — `busy_search` is the database's own search and a substring filter
here would quietly rewrite what that screen is testing.

---

## What is still open

- **The desktop font floor.** I told you last time that 12px was the floor
  "everywhere" and lifted `.pill` to match. That was wrong about the rule:
  docs/23 puts the 12px floor in the phone section and says in the next
  paragraph that **the desktop does not move**. The `.pill` change is shipped
  and better, but I have not swept the desk for the other sixteen sub-12px
  sizes, and on the frozen-desktop reading I should not. Worth one decision
  from you: does the 12px floor apply at a desk too?
- **Vendor master**, as above.
- The undated-opening note is untouched, as you asked.
