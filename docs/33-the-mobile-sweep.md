# The mobile sweep, done properly

Last round I reported the other screens "reflow without breaking". Two were
badly broken and he found both in five minutes. The reason is worth stating:
I ran assertions across every screen but only **looked** at two. Overlapping
elements do not overflow the page, are not too small and are not unreadable in
isolation — they are simply printed through each other, and nothing I had was
looking for that.

---

## The one that made the screen lie

He searched "Avon skd". The card read:

```
AVON NEWAGE CYCLES PVT.LTD              20 Apr 2026
SKD CONVEYOR
1.00 × ₹3,25,000                          ₹3,25,000
```

An SKD conveyor for ₹3.25 lakh. The row's description said **"Extension
Charges of SKD Conveyor 38 Fee"** — an extension of an existing conveyor by 38
feet. Not a machine.

**My rule dropped it.** I had written: drop the description when it repeats the
item, to stop `MS PIPE 80X40X2.5 · SIZE MS PIPE 80X40X2.5` printing one fact
twice. The test was *containment* — and "Extension Charges of SKD Conveyor 38
Fee" contains "SKD CONVEYOR". So the one line that changed the meaning was the
one thrown away.

Expanding the card made it worse: the description was replaced by Type,
Voucher, Year, Qty, Rate and Match — none of which he needs.

**Now:** the description sits under the item name, before anything else, two
lines while the card is shut and all of it once it is open. Never replaced,
never dropped. The only thing still dropped is a description that is *exactly*
the item written differently, letter for letter.

**`Match` is gone altogether.** It said how the search engine matched, not
anything about the business, and the yellow tint already says the row is a
guess.

Verified against his own rows:

| Item | Description now shown |
|---|---|
| SKD CONVEYOR | Extension Charges of SKD Conveyor 38 Fee |
| SKD (CYCLE ASSEMBLY CONVEYOR) ₹6,65,000 | — |
| SKD (CYCLE ASSEMBLY CONVEYOR) ₹12,00,000 | 130 FEET LENGTH |
| MS PIPE 80X40X2.5 · "MS PIPE 80X40X2.5" | dropped, it is the item again |

**The desktop table was checked for the same fault and is clean**: the
Description column wraps, is not clipped, and holds the full text.

---

## Two patterns, not two screens

**The header.** The salary sheet printed its title through the hamburger,
"Back", "Reset Columns" and "Save Draft" — five controls in one 390px row. PO
create, the vendor form, the item form and invoice entry would all have done
the same. Below the breakpoint: the way out and the title on the first line,
full width; everything the screen can do on the next line, wrapping, each at
least 44px. `display:contents` dissolves the grouping divs so the real
controls can be ordered wherever they were nested.

**The tabs.** Six tabs across 390px squeezed until "Employee Category" printed
through "Relationship". They scroll sideways inside their own strip now, page
still — and the chosen tab is scrolled into view, because a strip that scrolls
can leave the tab you just picked off the right-hand edge.

---

## The sweep — every screen, every tab, at 390px

Each one screenshotted and looked at.

| Screen | | |
|---|---|---|
| Home | **WORKS** | approvals and requests as cards |
| Km Tracker › Approvals | **FIXED** | was the table turned sideways; now who/when, vehicle, KM+Cost, readings, buttons at 46px |
| Km Tracker › Reports | **WORKS** | same card layout, Filters button already there |
| Km Tracker › Payments | **WORKS** | |
| Km Tracker › Settings | **WORKS** | |
| Salary Calculator | **DESK ONLY** | "The salary sheet needs a computer. Open it on a desktop." |
| Loans & Advances › both tabs | **WORKS** | |
| Vendor | **WORKS** | search, status, page size and + Add stack cleanly |
| Employee Master | **WORKS** | |
| Who can do what | **DESK ONLY** | "Who can do what needs a computer. Open it on a desktop." |
| HR Dropdowns › 6 tabs | **FIXED** | tabs overprinted; now scroll inside the strip |
| Documentation | **WORKS** | its own tree at 44px |
| Busy › Price History | **FIXED** | the description fault above |
| Busy › Challans | **FIXED** | same screen |
| Busy › Reports | **WORKS** | KPI tiles stack one per row |
| Busy › Deleted in Busy | **WORKS** | |
| Busy › Load history | **WORKS** | readable, though in practice a desk job: the files are on the Busy PC |
| Busy › Download the uploader | **WORKS** | |
| Busy › Setup instructions | **WORKS** | |
| Sign in | **WORKS** | |
| Add a km reading | **WORKS** | the one a fitter actually uses |
| Set password | **WORKS** | |

Every one: no overlap, nothing sideways, nothing under 12px, every control
44px or more.

---

## What would be BETTER — not asked for, noticed while looking

1. **Dates print as `2026-09-18` on Km Tracker**, not `18 Sep 2026`. It is
   raw ISO straight from the database, and it is the same on the desktop — so
   it is a desktop change and I have not made it. Worth doing across the ERP
   in one pass.
2. **"No employee categorys yet."** A plural built by adding an "s". Small,
   and it is on a screen you show people.
3. **The vendor list's pager** puts "Showing 0–0 of 0" beside Prev / Page /
   Next on one cramped line. Busy's pager already solved this — position
   above, buttons below. The same treatment would suit it.
4. **Load history is a desk job in practice.** The screen works on a phone,
   but the files it wants are on the Busy PC. It may deserve the desk-only
   line for honesty, not because it is broken. Your call.
5. **The description could carry the search highlight into the expanded
   view** — it does, but long descriptions clamp at two lines when shut, and a
   highlighted match on line four is invisible until you tap. Worth showing the
   matching line first when searching.
6. **`Back to ERP` is gone from Busy on a phone** and the menu replaced it.
   The same button still sits at desk width; now that every page carries the
   menu it may be redundant there too.

---

## The desktop did not move

Checked at 1360px in the same run: the price table is on screen and the cards
are not, eleven columns, filters in the bar, Columns control there, headings
sticky, the menu a column down the left, and the salary sheet is the salary
sheet with no notice on it.

## Tested

| | |
|---|---|
| `tests/phone.test.js` | **113 of 113** — adds the description rows, the overlap check across every screen and tab, the tab strip, and the desk-only notices |
| `tests/cold-open.test.js` | 108 of 108 |
| `tests/nav.test.js` | 46 of 46 |
| `tests/busy.test.js` | 209 of 209 |
| `tests/admin-permissions.test.js` | 28 of 28 |

**One thing the tests caught that I would have shipped:** the desk-only rule
landed *inside* the media query, so the notice was hidden on a phone and shown
at a desk — exactly backwards. The desk-width assertion failed and said so.
