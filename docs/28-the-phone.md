# The ERP on a phone

> "Opened erp.refconveyors.net on my phone. There is NO MENU AT ALL. No left
> nav, no hamburger, nothing. So on a phone the ERP is one page and a Log out
> button."

He is right, and it was one line of CSS:

```css
@media (max-width: 880px) {
  .sidebar { display: none; }
}
```

Hiding the nav on a narrow screen is correct — there is no room for a 232px
column beside a 380px page. But nothing was ever built to bring it back. Every
screen except Home was unreachable, and no test said so, because every test ran
at 1360px.

---

## The menu

A hamburger in the top bar, 44x44, on **every** page. It slides the same menu
in over the page — over, not pushing it sideways, so nothing reflows when it
opens — with a backdrop behind it.

It closes four ways: the hamburger again, tapping the backdrop, Escape, and
**picking something**. That last one matters: a drawer you have to close by
hand is a drawer covering the answer you just asked for.

One menu, not two. Busy Data used to turn its nav into a strip of items
scrolling sideways above the screen — workable, and a different thing from
everywhere else. Both pages now use the same markup, the same breakpoint
(880px, where they were 880 and 860 before) and the same behaviour.

---

## Then every screen, at 380 x 740

Measured before anything was changed, then measured again after. Every screen
in the ERP and every screen in Busy Data.

### What was wrong

| | Found |
|---|---|
| **Tap targets** | `Log out` 68x28 · `Add loan` 91x28 · `Create sheet` 147x28 · the clear-search x **20x21** · every Busy button 30px tall · the km-tracker sub-tabs **19px wide** · `Back to sign in` **274x14**, a link only as tall as its own letters |
| **Text** | 10px section labels, 10.5px pills and captions, 11px page subtitles, 11.5px in nine inline styles |
| **Sideways scroll** | the documentation screen pushed the page 7px wider than the phone, because one long unbroken word would not wrap |
| **Tables** | `max-height: none` on a phone, so a 200-row table scrolled the whole page and took the column headings away with it |
| **Fields** | 15.5px inputs — iOS zooms the whole page at anything under 16px — and nothing keeping the keyboard off the bottom field |
| **Three screens crashed outright** | km-tracker, vendor-master and the admin panel |

### What it is now

- **44px minimum** on every button, link, select and menu item. Height comes
  from padding, so nothing is stretched out of shape.
- **Nothing under 12px**, and the things a person actually reads — table rows,
  labels, messages — at 13px or more. Text was made **bigger, never smaller**.
  A screen that "works" at 10px is a screen that cannot be read.
- **16px in every field**, which is the threshold below which iOS zooms the
  page the moment a field is tapped.
- **`scroll-margin-bottom` on every field**, so the browser keeps room under
  it and the keyboard does not sit on top of the thing being typed into.
- **The page never scrolls sideways.** A wide table scrolls inside its own box
  — and keeps its column headings while it does.
- Long unbreakable words wrap. A word breaks before a page does.

---

## The three crashes, which were not a phone fault

While walking the screens, three of them threw and left a blank page:

```
km-tracker    Cannot read properties of undefined (reading 'filter')
vendor-master Cannot read properties of undefined (reading 'filter')
admin-panel   Cannot read properties of undefined (reading 'length')
```

All three check `res.success` and then use a list the reply did not carry.
This is the same family as the Home screen fault from the last round, and the
opposite failure: Home turned a broken reply into "Nothing pending right now",
these turn it into a blank screen with no explanation.

Both are now answered the same way: an **absent** list is a broken reply, not
an empty one. `requireLists()` says which list the server left out, in red, and
says plainly that this is not an empty screen. Not in scope for the phone work
— reported here rather than fixed quietly.

---

## Which screens have to be good, and which only have to not break

He drew this line and it is worth writing down:

| | What it has to be |
|---|---|
| Raising a material request, approving, looking up a past price, checking a ledger balance before a call | **good**, not merely functional |
| Building a purchase order, the salary sheet, the permission grid | **reflow without breaking** — nobody builds a PO on a phone, and pretending otherwise would ruin the desktop screen |

Both pass the checklist. Only the first has to be pleasant.

**Approvals that need care stay desk-only**, as locked. A phone screen works
against careful checking, and that is a decision rather than an oversight.

---

## Tested at a real phone width

`tests/phone.test.js`, at 380x740 with `isMobile` and `hasTouch` — **not** a
shrunk desktop window. That distinction is the whole point:

| A shrunk window | A real phone |
|---|---|
| keeps the mouse, so hover still reveals things | there is no hover |
| keeps `click`, so a broken tap target still works | `tap` is what fires |
| does not match `isMobile` media features | it does |

**86 of 86.** For every screen: the menu opens and closes, nothing runs off the
side, every control is at least 44px, nothing is under 12px, a form can be
filled without the keyboard hiding a field, and the price table scrolls inside
its own box with its headings staying put.

Two things proved by breaking them on purpose:

- Removing the hamburger again makes four checks **fail** rather than the test
  run falling over silently — which is what happened on the first attempt, and
  a test that crashes says nothing at all.
- The table check first proves the table really is wider than the phone, so it
  cannot pass on a table that never needed to scroll.

And the desk width is checked in the same run: at 1360px the hamburger is not
in the document at all and the menu is still a column down the left.

Everything else still passes — **202 of 202** on Busy Data and **28 of 28** on
the permission screen, unchanged.
