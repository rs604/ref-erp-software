# One menu, every page

> "YOU HAVE NO NAVIGATION. Not on a phone, not on a desktop. The only
> navigation in the whole ERP lives inside admin.html and only appears once I
> am already there."

He is right, and it was worse than the phone problem I fixed last round. I
built a hamburger into two pages and reported success. **That was the wrong
answer to the right question** — and I should say plainly that he found the
real fault, not me.

| Page | Navigation before |
|---|---|
| `index.html` | none |
| `admin.html` | its own, hand-written |
| `busy.html` | its own, hand-written, could not reach admin's screens |
| `submit.html` | none — a fitter sent a reading and was at a dead end |
| `reset.html` | none |

---

## What was built

**`nav.js` — one file, loaded by all five pages.** It holds the list, the
permissions, the drawer, the hamburger and the styling. Adding a screen to the
ERP is a line in that file and it appears everywhere at once. There is no
second copy to forget.

```
Home
Busy Data      REF: Price History · Challans · Reports · Deleted in Busy
               RS:  Price History · Challans · Reports · Deleted in Busy
               Loading: Load history · Download the uploader · Setup
HRMS           Km Tracker · Add a km reading · Salary Calculator · Loans
Masters        Items · Units · Vendors · Customers · Employees
Purchase       Requests · Orders · Follow-up · Approvals
Accounts       Purchase invoices · Payments · Advances
Production
Reports
Settings       Users & permissions · HR dropdowns
─────────────────────────────────────────
OWNER ONLY     Decisions · Checklist
```

Busy Data is second, as asked. Desktop: a column down the left. Phone: the
same list, opened by a hamburger at the top left, sliding in over the page,
closing on the backdrop, on Escape, and on picking anything.

### Three decisions worth stating

**HRMS is not in docs/11.** That list was locked on 10 September, before the
salary sheet, the km tracker and the loans screen existed. All three are used
daily. Leaving them out of the locked menu would have made working screens
unreachable, so they are in, as their own module. **Open question:** keep HRMS
as a module, or fold those three in elsewhere.

**A screen that does not exist yet is shown to the owner and says "not built
yet".** Thirteen of them. It is not a button that quietly does nothing, and it
is not hidden — the shape of his own ERP is his to see. It is **not** shown to
anyone else, who would be reading a roadmap instead of a menu.

**The sign-in page loads the menu file but draws nothing.** A signed-out
stranger is not told which screens the ERP has, and a signed-in person is
redirected off that page before a menu could help them. `reset.html` is the
same when it is reached as a **forced** first password change: a menu there
would be a way to walk past the thing that screen exists to make someone do.
Reached by choice, it carries the menu like anywhere else.

---

## Opened at 380px, and every page reached from every page

Not "a link exists" — the test opens the drawer, opens the module, taps the
entry, and checks which page it landed on.

| From | admin.html | busy.html | submit.html |
|---|---|---|---|
| **admin.html** | — | reached | reached |
| **busy.html** | reached | — | reached |
| **submit.html** | reached | reached | — |
| **reset.html** | reached | reached | reached |
| **index.html** | draws no menu, by design — nobody is signed in |

The menu is byte-for-byte the same list on every one of them: 21 entries, the
same modules, the same order.

---

## Permissions: absent, never greyed

A fitter with `km_tracker.submit` and nothing else sees **two entries**: Home,
and HRMS → Add a km reading. No Busy Data, no owner section, no not-built
roadmap, and nothing sitting there disabled — a greyed button still tells
someone the screen exists.

---

## What this replaced

- `admin.html`: the hand-written `<nav>`, `applyNavVisibility()`, the tree
  expand/collapse code, the per-view ancestor-tree table, the drawer, and the
  sidebar CSS. The page now says which page it is, who is looking, and what to
  do when one of its own screens is picked. Nothing else.
- `busy.html`: the same, plus its sideways-scrolling strip of nav items.
- `tests/harness.js` gained `H.go(page, view, firm)` — go to a screen the way
  a person does, through the menu, opening the module first. A test never
  needs to know the menu's markup; that knowledge lives in `nav.js` and
  nowhere else.
- `tests/check-page-set.js` now counts `nav.js` and the place it draws into as
  things every page must share, so a new page cannot ship without navigation.

---

## Tested

- **`tests/nav.test.js` — 41 of 41.** The same menu on every page; every page
  reaches every other page at 380px; the drawer opens, closes on the backdrop,
  on Escape and on picking something; arriving from another page lands on the
  named screen and carries the firm (RS Reports opens as RS Reports); a fitter
  sees two entries and nothing greyed; the sign-in page draws nothing; at a
  desk it is a column and there is no hamburger.
- `tests/busy.test.js` **209 of 209**, `tests/admin-permissions.test.js`
  **28 of 28**, `tests/phone.test.js` **86 of 86**.
- 5 pages agreeing on 9 shared things · 26 of 26 database call sites resolving
  · no test reading a cell by position.

---

## The lesson he asked to record

> "For weeks I have been using an ERP with no navigation and neither of us
> noticed, because I always arrived at admin.html through a bookmark. Worth
> asking what else is invisible because of how I happen to reach it."

This is now a standing rule in `docs/23`. How you habitually reach a thing
hides everything about reaching it any other way:

| Habit | What it hid |
|---|---|
| a bookmark straight to `admin.html` | there was no navigation anywhere |
| a desktop browser | the phone had no menu, and 30px buttons |
| signing in as the owner in every test | what a fitter's menu contains |
| opening a screen from its own page | arriving at it from another page |
