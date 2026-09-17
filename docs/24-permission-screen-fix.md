# The permission screen jumped to the top — what it was, and what now catches it

**Date:** 17 Sep 2026

Raghbir ticked a permission checkbox. It ticked, and the page jumped back to the
top. He ticked another. Same thing. Nothing errored. This is the fault that
`docs/23-screen-tests.md` was written for.

---

## What was actually wrong

Every click on that screen ran `renderAdminPanel()`, which rebuilt the whole
panel with `innerHTML`. That throws away the two scrolling `<div>`s — the
employee list on the left and the permission grid on the right — and builds new
ones. A brand new div starts at the top, so the browser had nowhere to put the
old position. Focus went the same way.

It was not only the checkboxes. The same full rebuild ran on the category
roll-up boxes, the column headers, Grant All, Revoke All, **and after saving** —
so saving a person's permissions also threw both columns back to the top.

Measured on the old page, driving a real browser:

```
permission checkboxes   clicked 58 ·  26 kept scroll · 32 moved
category roll-up boxes  clicked 21 ·  12 kept scroll ·  9 moved
column headers          clicked  5 ·   4 kept scroll ·  1 moved
Grant All / Revoke All  both threw both columns to the top
saving                  threw the grid to the top
typing in the search    threw the grid to the top
```

The 26 that "kept scroll" were simply boxes near the top of the list, where
there was no position to lose.

---

## What was changed

Only what the click changed is redrawn now. Nothing writes `innerHTML` over the
whole panel except the first draw.

- a permission box → its own box, and the category roll-up above it
- a category box → the boxes under it, in that column
- a column header → that column only
- Grant All / Revoke All → every box's `checked`, but no HTML is rebuilt
- search or a filter → the employee list only; the grid is not touched
- picking a person → the grid only; the employee list keeps its place
- saving → the one badge in the list that can have changed, and nothing else

Handlers are bound once, to the two containers, so a partial redraw can never
leave a dead button behind.

Three smaller things were fixed while in there, each found by the tests:

- **A part-ticked category read as empty.** Tick two of three sub-heads and the
  roll-up box above them showed unticked, quietly hiding the two that were on.
  It now shows the half-ticked state.
- **The column headers could not be reached by keyboard.** They are clickable
  and toggle a whole column, but were plain table headers. They now take Tab,
  Enter and Space, and clicking one no longer drops focus to nowhere.
- **The Home screen crashed on a reply with no list.** `pendingRes.success ?
  pendingRes.requests : []` gives `undefined` when a call succeeds but returns
  no `requests`, and the next line reads `.length` off it. Guarded.

---

## The result now

```
Roles & Permissions — docs/23 sections 1, 5, 8 and 10

  permission checkboxes    clicked 58 · 58 kept scroll · 0 moved
  category roll-up boxes   clicked 21 · 21 kept scroll · 0 moved
  column headers           clicked  5 ·  5 kept scroll · 0 moved
  Grant All / Revoke All   kept scroll
  saving                   kept the scroll position in both columns
  picking a person         left the employee list where it was
  typing in the search     left the permission grid where it was

  25 of 26 passed
```

---

## The one still failing, on purpose

**58 of the 61 permissions in the database have a box of their own. Three do not,
and can never be granted or revoked from this screen.**

- `purchase_request.cancel` — its action is `cancel`, and the grid has five
  columns: View, Create, Edit, Approve, Delete. There is no Cancel column, so
  the permission has nowhere to appear.
- `admin.users` and `admin.settings` — both sit at Admin / admin / edit, the
  same place as `admin.permissions`. The grid draws one box per sub-head and
  action and keeps the first permission it finds, so ticking that box grants
  `admin.permissions` alone. The other two are invisible and unreachable.

This is a rule someone decided and that is not enforced, which is exactly what
section 4 of `docs/23` is about. The fix is a design choice, so it is Raghbir's:

- **A**: add a Cancel column, and give the three Admin permissions their own
  sub-heads (`admin_users`, `admin_settings`, `admin_permissions`) so each gets
  its own row. Nothing in the grid changes shape beyond one extra column.
- **B**: change the grid from one row per sub-head to one row per permission.
  More rows, more scrolling, but no permission can ever hide behind another.

**The test is left failing until this is decided.** A deleted test is a
forgotten fault.

---

## How this is tested from now on

`tests/` holds the machine. A real Chromium browser opens the real page over a
local web server. `app-config.js` is swapped for a stub and every request to
anywhere but the local copy of the repo is refused, so a test run cannot reach
Supabase, cannot read or change company data, and cannot reach the internet. The
people in the fixtures are invented — this repository is public.

Two mistakes were made in writing the harness itself, and both are worth
recording because they are the same mistake in different clothes: reading the
tool's own behaviour as the thing being measured.

1. **The test driver scrolls to whatever it clicks.** The first run therefore
   reported that every click moved the page — on a page that had just been
   fixed. Controls are now brought into view *before* the state is recorded.
2. **Focus landing on the thing just clicked was counted as a fault.** It is
   correct behaviour. The comparison now allows it.

Both are written into `tests/README.md` so the next screen does not repeat them.
