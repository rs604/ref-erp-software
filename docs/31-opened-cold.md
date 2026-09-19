# Opened cold — what every page actually shows

Three answers, and the third is the one that found things.

---

## 1. Home is the dashboard

Confirmed and written into `docs/11`: **approvals waiting, and the state of the
business** — what Raghbir looks at first thing.

One correction to the premise. The Home entry does **not** point at
`index.html`. `index.html` is the sign-in page; it redirects a signed-in person
onward, which is why the root address lands on a screen with his name, a Log
out button and two cards. That screen **is** the dashboard — `admin.html`'s
Home view — and it is what the menu already points at. It is thin today and
fills in later, exactly as he said.

---

## 2. Not built yet is greyed, not hidden

Changed. Last round I made unbuilt screens owner-only, on the reasoning that a
fitter would be reading a roadmap. His rule is better and the reason is the
part worth keeping:

> "Absent, not greyed" applies to PERMISSIONS — things a person is not allowed
> to see. It does not apply to things nobody can see yet because they are not
> built. Two different reasons, two different answers.

| Why it is not usable | What the menu does |
|---|---|
| this person may not see it | **absent** — a greyed row still tells them it exists |
| it is not built yet | **greyed, visible, not clickable** — everyone sees it |

Thirteen greyed entries: Items, Units, Customers, Requests, Orders, Follow-up,
Approvals, Purchase invoices, Payments, Advances, Production, Reports,
Checklist.

A fitter now sees the whole shape of the ERP — twelve greyed rows and the
modules they sit in — and **still** cannot see Price History, Vendors,
Employees or the owner section, because those are permission, not progress.

---

## 3. The cold sweep — every page, both widths, signed in and not

A **cold open** is a brand-new browser with nothing stored, arriving straight
at the address. Not a link from another page, not a tab that already has a
session. 380px and desk width, signed in as owner and with no session at all.
Five pages, four openings each.

### What each page shows, signed in

| Page | Lands on | Menu | What is on it |
|---|---|---|---|
| `index.html` | **admin.html** | 21 | redirected onward, as designed |
| `admin.html` | admin.html | 21 | the dashboard, 18 buttons |
| `busy.html` | busy.html | 21 | Price History, 24 fields |
| `submit.html` | submit.html | 21 | the odometer form |
| `reset.html` | reset.html | 21 | the password form, with the menu |
| `reset.html?first=1` | reset.html?first=1 | **0** | the forced change, no way round it |

### What each page showed a stranger — three faults, all fixed

| Page | Before | Now |
|---|---|---|
| `admin.html` | **a blank white screen.** Nothing at all while the redirect happened — and for ever if it did not | "Taking you to the sign-in page… One moment." |
| `submit.html` | the whole odometer form, fields and all, rendered before the redirect | the same message, form not rendered |
| `reset.html` | a **"Set Your Password" form.** The server would have refused it, but inviting an action that cannot work is its own fault | the same message |

`busy.html` already did this correctly, which is why it was the one page that
looked right. `index.html` correctly shows its own sign-in form.

**The admin.html one is the serious one.** It is the address everybody
bookmarks. Anyone whose session had expired — or who was sent the link —
got a blank white page with nothing on it and nothing to do.

Three things are now asserted on every cold open with no session:

1. The page **says what is happening**. A blank page is a failure, not a
   redirect in progress.
2. The working screen is **not rendered behind it**.
3. **No company data** appears anywhere on it.

---

## And inside a page, where a sweep cannot see

`admin.html` holds nine screens behind one address. A screen reachable only
from inside another would have the same fault the whole ERP had, and no page
sweep would find it.

Checked both directions against the page's own markup:

- **All nine** — home, km-tracker, salary-calculator, loans-advances,
  employee-master, hr-dropdowns, vendor-master, admin-panel, documentation —
  have their own entry in the menu. **No orphans.**
- Nothing in the menu points at a screen that does not exist.

Twenty-one other hidden elements turned up on the first pass and are **not**
screens: conditional form fields — bank details, MSME numbers, ESI and PF
fields, driving-licence fields, loan instalment fields. They appear when a box
is ticked, which is what they are for.

A vendor's detail, an employee's record and a salary sheet are reached by
picking a row from a list. That list is in the menu, so the path exists; a row
is the natural way in and does not need its own menu entry.

---

## Tested

| | |
|---|---|
| `tests/cold-open.test.js` | **108 of 108** — new. 5 pages × 2 widths × signed in and not |
| `tests/nav.test.js` | **46 of 46** — now includes the inside-a-page check and the greying rule |
| `tests/busy.test.js` | 209 of 209 |
| `tests/phone.test.js` | 86 of 86 |
| `tests/admin-permissions.test.js` | 28 of 28 |
| static checks | 5 pages on 9 shared things · 26 of 26 call sites · no positional cells |

The phone test earned its place again on this round: `not built yet` shipped at
11.5px and it failed nineteen screens until it was raised to 12px.
