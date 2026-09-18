# UI decisions — every screen rule

**Locked:** 10 Sep 2026. Applies to every screen ever built in this ERP.

---

## The shell — what is always on screen

- **Top bar** — menu icon, REF logo, company name, search box on the RIGHT,
  notifications, who is signed in
- **Left nav** — collapses to icons, or hides completely
- **Work area** — everything else. Full width when the nav is collapsed
- **Bottom right** — one grey line: `Ctrl+/ for shortcuts`

### Nav order

Home · **Busy Data** · HRMS · **Masters** (Items, Units, Vendors, Customers,
Employees) · Purchase · Accounts · Production · Reports · Settings

Then a divider, then **OWNER ONLY**: Decisions · Checklist

- **Busy Data is second.** It is what Raghbir opens most
- **HRMS** was not in this list when it was written, 10 Sep 2026 — the salary
  sheet, the km tracker and the loans screen came later and are used daily.
  They are in the menu rather than unreachable. Open question for Raghbir:
  keep HRMS as its own module, or fold those three in elsewhere
- Owner-only items are **absent** for everyone else, not greyed out
- Only the open module expands. The list never gets long
- A screen that does not exist yet is **shown to the owner** and says
  "not built yet". It is not shown to anyone else, who would be reading a
  roadmap instead of a menu

### One menu, one file

`nav.js` holds the list and the behaviour. **Every page loads it** — admin,
busy, submit, reset and the sign-in page. Adding a screen is a line in that
file and it appears everywhere at once.

For weeks the only navigation in the ERP lived inside `admin.html`, and it
only appeared once you were already there. Nobody noticed, because Raghbir
always arrived at `admin.html` through a bookmark.

---

## Tables — same everywhere

- **Header** — soft blue-grey band, text bold and black, centred
- **Rows** — alternating white and a very pale tint
- **Thin vertical line between every column.** Thin horizontal line between rows
- **Centred** — everything except names and descriptions, which stay left
- **Sr. column first** — always labelled "Sr.", never "S.No"
- **One column takes the slack**, usually the name. Everything else fixed width,
  so the table fills the screen with no gap at the edges
- Status colours override the stripe. A red or amber row keeps its colour

### Pagination

- 10 · 25 · 50 · 100 · 200 · **All**
- Default 25. Choice remembered per person
- **All** shows the whole database in one continuous sheet, like Google Sheets
- **Ctrl+Up** to the top, **Ctrl+Down** to the bottom
- Must use virtual scrolling, or 4,490 rows will freeze the browser

### Search

- **Focus lands in the search box when the screen opens.** No clicking to start
- Searches the whole database, not the page you are looking at
- **Exact match** — the matching letters highlighted in yellow
- **Fuzzy match** — the whole row shaded light yellow, because there are no
  literal letters to highlight
- Filter chips work together with search

---

## Forms — same everywhere

- **Field height 30px.** Every field, every dropdown, every button
- **Label above the box**, small caps, grey
- **Red asterisk** on mandatory fields, aligned on the same line as the label
- **Three columns** for dense sections. Never four — it gets congested
- 16px vertical gap, 20px horizontal gap, 14px section padding
- **Dropdowns use a chevron icon**, never a text arrow
- **Greyed fields** are filled by the system — GST from HSN, state from GSTIN,
  category from group. Visible, but not yours to type

### Buttons

- **Plain words** — Save, Cancel, Approve, New item
- **Shortcut lives in the tooltip**, not in brackets on the button
- Same height as form fields
- **Inside the card they belong to.** No divider line above them
- Page-level actions stay in the page header; form actions go on the form

---

## Keyboard — Busy accounting style

- **Enter** and **Tab** both move to the next field
- **Shift+Tab** moves back
- **Enter never saves.** Only F2 does. Nobody loses work by pressing Enter
- **Esc** cancels, then exits
- Dropdowns: type to filter, Enter picks and moves on
- In tables: Enter moves across the row, Enter on the last cell makes a new row.
  Arrows move like a spreadsheet
- **Multi-line fields are the one exception** — Enter makes a new line there,
  Tab moves on

### The keys

| Key | Does |
|---|---|
| F2 | Save — everywhere, always |
| F3 | New record / vendor search |
| F4 | Edit / item search |
| F5 | Add contact person |
| F6 | Delete row |
| F7 | Add bank account |
| F8 | Price history |
| F10 | Terms panel |
| Ctrl+D | Save as draft |
| Ctrl+K | Global search |
| Ctrl+/ | Shortcut list |

---

## Esc on an unsaved form

Never exits silently. A popup asks:

- **Save as draft** — keeps everything, leaves
- **Discard** — throws it away, leaves
- **Cancel** — stays exactly where you were, cursor back in the same field

Does **not** appear when nothing has been typed, when only viewing, or when
everything is already saved.

Esc also closes popups — the top one first, then the form.

---

## Popups stack, never replace

- Popup 1 → click something → popup 2 opens on top
- Esc closes one level. Nothing is ever lost
- **Two deep is the limit.** Three is confusing
- Each popup remembers its state when you come back to it

---

## List screens — the pattern

- **Everything shows by default** — approved, draft, pending, blacklisted
- **Why:** hide drafts and someone creates a duplicate that is already waiting
- Status shown on the row so nobody mistakes a draft for usable
- Filter chips with real counts
- **"Update needed" chip** — one general flag per master, with the reason on the
  row. New reasons get added later without redesign

### Vendor and customer lists only

- **10 most recently added shown by default.** Search reaches all of them
- **Why:** one screenshot should never capture the whole supplier list
- Counts are shown honestly — hiding them protects nothing
- **Drafts and pending always fully visible**, or people re-enter them
- Every search and every record opened is **logged quietly**
- Opening an unusual number in a day notifies the owner. Threshold in settings

---

## Record screens — the 360° pattern

- **Top block** — name, code, status, the two or three numbers that matter.
  Always visible
- **Tabs below** for anything that grows — history, bills, payments, files
- **Small fixed lists stay as plain blocks**, not tabs. Change history is one
- **Tabs that grow get filters, not a search box.** Nobody searches a price
  history by typing; they narrow it by vendor and date
- Sections not yet built are greyed with a note, not hidden

---

## Approval screens — the pattern

1. **A list first.** Enter on any row opens that one. No working through 1 to 5
   to reach 6
2. **Split screen** — the pending record on the left, a live search into the
   master on the right, pre-filled with the pending record's name
3. **Buttons at the bottom only**, after both panels. Nothing to hit by accident
4. Arrows move through the queue once inside

- The list shows **why a row needs care** — how many similar records exist, how
  long it has waited, whether the name matches its pattern

---

## Colours

| Colour | Means |
|---|---|
| Red | Blocked, overdue, missing something mandatory |
| Amber | Needs attention, still usable |
| Green | Best rate ever, confirmed, matched |
| Grey | System-filled, or not applicable |
| Light yellow | Search match |

- **Never say "error"** for something that is merely incomplete.
  Say what is missing: *"HSN 8414 has 4 digits. Your setting requires 6."*

---

## Numbers

- **Days as a single signed number**, never weekly buckets
  - `+9` = nine days overdue · `0` = due today · `−28` = 28 days remaining
- Sorted highest first, so the most overdue is at the top
- Positive red, zero amber, negative plain
- Indian format — `₹1,50,000`, not `₹150,000`

---

## Human numbers

- **Items** — plain running number from 5000000. No prefix. Internal only
- **Vendors** — `V-0042`
- **POs** — `PO-2026-0047`
- **Why the difference:** POs and vendor codes appear on printed documents and
  in conversations with outsiders, so a prefix stops confusion. Item codes never
  leave the building

---

## What the person does versus what the system does

- **Typed by a person:** names, quantities, rates, dates, reasons
- **Filled by the system, never typed:** codes, statuses, totals, GST from HSN,
  state from GSTIN, category from group, stock, last purchase rate
- **Why:** a typed number goes stale and cannot be explained later. A derived
  one can always be traced back to the document it came from

---

## Mobile

- Only a few screens are genuinely used on a phone — raising a material request,
  approving from the floor
- The rest are desktop screens that reflow. They are not designed for a phone
- **Approvals that need care are desk-only.** A phone screen works against
  careful checking
