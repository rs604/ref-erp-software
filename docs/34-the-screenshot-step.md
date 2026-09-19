# The screenshot step, kept

He said: *"Keep the screenshot step permanently."*

Last round the screenshots were a scratch file in a temp folder that dies with
the session. That is not keeping it. This round it became
`tests/sweep.test.js`, which runs with everything else and takes a picture of
every screen in the ERP at 390×844.

It found three faults on its first proper run, and a fourth came out of
building it.

---

## What his four "yes"es turned into

**1. The description on the desk table — ellipsis, full text on hover.** Done.
One line, clipped with `…`, and the whole of it in the cell's `title`.

This took three attempts. `table-layout:fixed` was the obvious answer and it
is the wrong one here: eleven columns do not fit, and twice it squeezed Party
to nothing and printed it through Item. What works is an auto-layout table
with the clip on an **inner block** — a cell sizes itself to its content, so
capping the content is what caps the column.

**2. Amount in the collapsed card.** Already there, and now confirmed by
looking rather than by assuming: `₹1,62,908.15`, bold, on the right.

**3. Quantity and unit in the collapsed card.** Half of this cannot be done.
The quantity is there — `61.19 × ₹2,662.33` — but **Busy has no unit column**.
`select column_name … ilike '%unit%'` returns `qty` and nothing else. There is
no unit in the data to show, so nothing invents one.

**4. A total row.** Not built, as he said: the rows are different items from
different years and adding them means nothing.

**5. Remember the column widths, per person, in that browser.** Done. Drag a
column edge; double-click it to put it back. Stored in `localStorage` under
`ref-busy-column-widths`, beside the show-and-hide choice.

---

## The bug that item 5 introduced, and the test that caught it

The drag grip is positioned absolutely inside its `th`, so I gave the `th`
`position:relative` to anchor it.

`th` was already `position:sticky`. **`relative` replaced it.** The column
names stopped staying put and scrolled away with the rows — the exact fault
the sticky header exists to prevent, reintroduced by a one-line convenience.

The desk assertion caught it:

```
FAIL  at a desk the headings still stay put while the rows scroll under them
      {"scrolledDown":true,"headingsStayed":false}
```

`sticky` is itself a positioned element, so it is already the containing block
the grip needs. The `relative` line was never necessary. It is gone, and the
comment in its place says why so it does not come back.

---

## What the pictures found

**The setup instructions were cut off mid-word.** The `config.txt` block on a
phone read:

```
upload_token = (shown on the download scre
```

A sideways scrollbar inside a box is not a fix — nobody finds it. The lines
are short, so they wrap now. This is the one screen in the ERP a person reads
while standing at a PC they have never set up before; a truncated instruction
there is the worst place for one.

**A raw `2026-09-18` on the approvals card.** Every other date in the ERP
reads `18 Sept 2026`. The helper to do it already existed three hundred lines
below. Fixed here and on the payment-batch print, which had the same raw date.

**An empty dashed square beside each odometer reading.** It read as a picture
that failed to load. It was not — it meant no photo had been taken. Now it
says so, in words: `not taken`, or `photo gone` when the file was expected and
is missing. Two different facts, two different words, neither of them a dash
in an empty box.

**And a fault in the sweep itself.** The step that opens a price-history card
ran after the loop that visits every screen, so the page was sitting on the
setup instructions — and `#cards` keeps its rows in the DOM while hidden, so
the click landed on an invisible card. It passed. The picture was of the setup
page. A test that passes on the wrong screen is worse than no test; it now
navigates back to Price History first.

---

## The desk-only wording

He was right that "open this on a computer" is no use to somebody standing on
the shop floor. Both notices now say why in the same line:

> The salary sheet needs a wide screen for the grid. Open it on a computer.

> Who can do what is a grid of sixty-one permissions that has to be read
> across. Open it on a computer.

---

## Where the pictures are

`tests/shots/`, remade on every run, gitignored. The run prints the folder and
prints this underneath the score:

> A green run means the detector found nothing. It does not mean the screens
> are right. OPEN THE PICTURES.

That line is there because a green run is exactly what I had last time.

---

## The suite

```
check-no-positional-cells / check-page-set / check-rpc-calls   pass
admin-permissions.test.js       28 of 28
busy.test.js                   209 of 209
cold-open.test.js              108 of 108
nav.test.js                     46 of 46
phone.test.js                  120 of 120
sweep.test.js                   31 of 31, 29 screenshots
check-live.js                  main matches the repo
```

---

## Still not built

**The ledger screen.** He named it as one of the four that genuinely matter on
a phone. It does not exist. The numbers behind it are verified — Hindon
Metaforms opening −483,537, movement +524,787, closing 41,250, exact to the
rupee — and docs/14 locks how the closing line reads (PAYABLE or RECEIVABLE,
Cr or Dr after the amount). It is the next thing worth building.
