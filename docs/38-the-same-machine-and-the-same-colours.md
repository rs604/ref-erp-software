# The same machine, and the same colours

**Date:** 19 Sep 2026 · **Status:** live on main · **Migration 71**
`71_a_description_that_means_the_same_thing`

Three things: the price history now matches on the description as well as the
item name; every colour in the ERP comes from one file; and REF and RS are
foldable branches of the menu rather than faint labels.

---

## 1 · Two sales of the same name are not two prices

> Three sales of "SKD CONVEYOR" at ₹3.25 lakh, ₹85 lakh and ₹1.2 crore are not
> three prices for one machine. They are an extension, a drive unit and a
> complete conveyor. Showing them as a price history is worse than showing
> nothing, because it looks like an answer.

He is right, and the figures are worse than he remembered in one direction and
better in another. **SKD CONVEYOR, REF, sales invoices, item rows — eleven
sales:**

```
2023-04-12  R S INDUSTRIES          5,45,000   60 FT. LENGTH
2023-06-12  R S INDUSTRIES          7,25,000   70'
2023-06-19  AKSON INDUSTRIES        2,87,500   (no description)
2023-06-21  MAGMA BIKES             2,00,000   (no description)
2024-03-27  R S INDUSTRIES          9,00,000   (no description)
2024-07-26  DLYFT INDIA LLP         3,00,000   EXTENTION MATERIAL 35' | DOC.NO...
2024-08-03  JATINDRA UDYOG          6,00,000   (no description)
2024-10-22  NAVYUG NAMDHARI         2,40,000   25 FEET EXT.
2025-03-17  MAGMA CYCLES            3,00,000   (no description)
2026-04-20  AVON NEWAGE CYCLES      3,25,000   Extension Charges of SKD Conveyor 38 Fee
2026-06-18  HMC E-VALLEY           26,25,000   NEW SKD ASSEMBLY LINE WITH ACCESSORIES
```

His ₹3.25 lakh is exact — Avon, an extension of 38 feet. The top of the range
is **₹26.25 lakh**, not ₹85 lakh; ₹1.2 crore is the INCLINED SLAT CONVEYOR
figure, a different item. The argument stands completely: an extension and a
complete assembly line were sitting in one list under one heading.

### The rule

The one already locked for search everywhere in this ERP:

**FUZZY ON WORDS, EXACT ON NUMBERS.**

- `busy_numbers()` of both descriptions must be **identical** before anything
  else is looked at. `130 FEET` and `38 FEET` can never be called comparable.
- Then the words: every word of the **shorter** description must have a
  partner in the longer one — the same word, or near it by `busy_near`. That
  is what makes `LENGTH` harmless in `130 FEET LENGTH`.
- **Blank matches only blank.** 1,886 of 3,842 sale lines carry no description
  at all; if blank matched everything the fault would come straight back
  through the emptiest rows.
- Digits belong to the numbers, not the words, so `6MM` and `6 MM` are the
  same thing written twice.

Checked against the live function:

```
busy_comparable('130 FEET LENGTH', '130 FEET')      true   ← his example
busy_comparable('130 FEET',        '38 FEET')       false
busy_comparable('',                '')              true
busy_comparable('',                '130 FEET')      false  ← blank is not a wildcard
busy_comparable('60 FT. LENGTH',   '70''')          false
busy_comparable('6MM PLATE',       '6 MM PLATE')    true
busy_comparable('CONVEYOR',        'CONVEYER')      true   ← fuzzy on words
busy_comparable('CONVEYOR',        'EXTENSION')     false
```

### What it does to the real data

Opening the Avon extension: **eleven sales collapse to one — itself.** The
panel says "No comparable earlier sale", not an empty box and not a list.

Where it earns its keep is the opposite case. **CONVEYOR BEND** has 19 sales,
and one 90°×3' radius bend is written seven different ways:

```
90 DEGREE 3" R  ·  90 DEGREE 3' R  ·  3' R X 90 DEGREE BEND
90 DEGREE X 3 R ·  90 DEGREE X 3' R ·  90 DEGREE BEND X 3' R
```

All seven are now one price history, ₹4,500 to ₹28,000. Spelling and word
order stopped mattering; the number never did.

### And it says what it matched

Under the price history, one line:

```
2 sales of INCLINED SLAT CONVEYOR, L 24 FT X 3 FT W — never averaged.
Matched on the item name AND the description: fuzzy on words, exact on
numbers — "130 FEET LENGTH" and "130 FEET" are one machine, "130 FEET"
and "38 FEET" are not. A sale with no description matches only other
sales with no description.
```

Every matched sale is listed with **its own description**, not just an amount
and a year, because the word rule lets the longer description carry words the
shorter one does not. He can see what was compared rather than trust it.

A test fixture answers the same rows whatever it is asked, so the only thing
this side can be checked on is the **question**. The harness records every RPC
now, and the test asserts the panel hands the server the picked sale's own
description and asks it to match — while the "check another item" box, which
has no sale in hand, does not. Proved by turning the matching off: the
assertion named it, and busy.html was restored byte-exact.

The same sentence is printed under "No comparable earlier sale" — that is the
one he will doubt.

---

## 2 · One place for the colours

> busy.html was built as its own page and never inherited the colours
> everything else shares. Make every colour on busy.html come from the same
> place admin.html gets its colours. Not a hand-matched shade — the same
> source.

The menu was **not** a busy.html fault. `nav.js` draws the same menu on every
page and carried its own hard-coded `#1a2229` — so the left nav was near-black
on admin.html too, and had been since the shared menu shipped. There were
**three** copies of the palette: admin.html's, busy.html's, and nav.js's hexes.

New file: **`theme.css`**, linked first by all five pages. It holds every
token, and `nav.js` now draws itself from `--nav-bg`, `--nav-ink`,
`--nav-active`, `--nav-accent`. The left nav is `var(--steel-dark)` — the same
blue the rest of the ERP is built out of — and the active screen carries the
amber left edge the ERP has always used for "you are here".

The drift the two copies had already produced:

```
--border           busy #dfe4ea   admin #d8dee5
--surface-sunken   busy #f6f8fa   admin #eef1f4
--slate-bg         busy #f0f3f6   admin #eaedf0
the left nav       nav.js #1a2229, on every page, matching neither
```

**The white page is kept, and is now a named decision.** `busy.test.js` asserts
the Busy Data page is white — a screen that is one long table sits on white so
the alternating rows are the only tint. Unifying `--paper` broke it, and the
test caught it. So `--paper-plain: #ffffff` is a token in `theme.css` with the
reason beside it, rather than a second palette in a second file.

### What else the whole-page check turned up

- **A full-screen overlay with no background.** busy.html's "Checking who you
  are." panel was `background:var(--bg)`. `--bg` is not a colour in this ERP
  and never was, so the overlay was **transparent** and the half-drawn page
  showed through it. A CSS variable that does not exist fails in silence:
  no error, no warning, and the tests stub the data so the overlay is gone
  before a screenshot is taken.
- **A pill at 10.5px on the desk.** 12px is the floor (docs/23 §9). `.pill`
  was lifted to 12px only inside the phone media query, so "no buys since Mar
  2024" and "this one" were read at 10.5px at a desk. The floor is not a
  phone rule.
- **Two dead copies of a menu.** 27 lines in busy.html and 40 in admin.html
  describing a `.sidebar` neither page has had since nav.js arrived — a second,
  unused description of the very thing that was the wrong colour. Removed after
  proving every one of those selectors matches zero elements in the repo. What
  looks like the same thing in admin.html is **not** dead: `documentation.js`
  builds the Decisions tree out of `.nav-item`, and that stayed.

---

## 3 · REF and RS are branches, not labels

Both headings are now **bold and bright**, each with an arrow, and each folds
its screens away. Opening one closes the other — "I work in one firm at a time
and RS is a fraction of the data" — so the menu shows four screens, not nine.

Which one is open is remembered **per person**: the key is the signed-in
person's id, so two people on one machine keep their own answer. Arriving on a
screen counts as using its firm, so the firm he was last in is the one that
opens next time. `localStorage` is wrapped both ways — a phone in private mode
throws on read *and* on write, and a menu that will not draw because a
preference could not be saved is a worse fault than a preference forgotten.

**And the page opens there too.** Opening the menu on RS above a screen of
REF's figures would be worse than either default, so busy.html asks
`REFNav.lastSection()` which firm to start in when the address bar names no
screen. Arrive by a link and the link still wins.

```
REF and RS are headings of their own in the menu           REF · RS · Loading
and both are BOLD, not faint labels                        REF 700 · RS 700
exactly one firm is open on arrival — not both, never none REF open · RS shut
clicking RS opens RS and folds REF away                    REF shut · RS open
and REF's screens are gone from the menu, not merely faint
the choice is stored against the person, not the machine   RS
and next time it opens the firm he used last               RS open · REF shut
one person's choice is not another's
the left menu is the ERP's --steel-dark                    rgb(31,53,71)
```

Proved by letting both firms stay open at once — two assertions named it — and
restoring nav.js byte-exact.

### Found by looking at the picture, not by an assertion

Opening the drawer on a phone showed **two rows that both looked picked**:
Price History with the amber "you are here" edge, and Home inside a thick
amber box. The box is the browser's own focus ring — Chromium draws it
`rgb(229,151,0)` on a dark background, all but identical to `--amber`. Nothing
failed; the menu simply read as though Home were selected.

Two changes: the menu has a focus ring of its own now (white, which cannot be
mistaken for the accent), and opening the drawer focuses **the screen he is
on** rather than the top of the list. The drawer also gets its own picture in
the sweep from now on, at the viewport size — a full-page shot of a fixed
drawer is a 49,000-pixel photograph of the page behind it.

---

## Two guards, so neither class of fault returns quietly

Added to `check-page-set.js`:

- **`theme.css`, linked by every page, at the build version.** A page reload
  appends `?_v=` to the *page*; it does nothing for a stylesheet the browser
  already holds. The link carries the build version and it must match
  `version.txt`, or a browser is served yesterday's colours over today's page.
- **`var(--x)` must resolve.** In `theme.css` or in the page's own rules.
  `var(--x, fallback)` is fine — it says what happens when `--x` is absent.
  `var(--x)` alone does not.

Both proved by breaking them on purpose — `--paper` back to `--bg`, the theme
link back to an old version — and the file restored byte-exact (md5 checked).

```
FAIL  the pages disagree about theme.css, the one palette every page links
FAIL  busy.html asks for theme.css?v=1700000000 but version.txt says … —
      it would be served yesterday's colours
FAIL  busy.html uses var(--bg), which is defined nowhere — that rule does
      nothing, silently
```

---

## The migration

`71_a_description_that_means_the_same_thing`, md5 `ec0bfdd140e12c14a3085bc72fbc03a6`,
verified against the database's own fingerprint after recovering the file.

```
busy_desc_words(text) -> text[]          the letters, one word each
busy_comparable(a, b) -> boolean         does this mean the same machine
busy_item_price_history(p_company, p_item, p_desc, p_match_desc)
```

`p_match_desc = false` is the "check another item at that time" box at the
bottom of the panel, where there is no sale in hand to compare against and
every priced sale is what is wanted. The old two-argument function was dropped
so PostgREST has one thing to resolve.

---

## What is still open

- **Half the sale lines have no description.** 1,886 of 3,842. Blank matches
  only blank, as asked — but that means the blank group is large and wide:
  INCLINED SLAT CONVEYOR with no description is 18 sales from ₹1.55 lakh to
  ₹12 lakh, and they are "comparable" only because nothing was written down.
  The panel prints "(no description)" on every row so it is visible, but the
  real fix is in Busy, not here.
- **The word rule allows extra words.** `GOODS LIFT` matches `OF GOODS LIFT`,
  which is right, and it would also match a much longer description that
  happens to contain both words and the same numbers. A stop-word list would
  be stricter and would be a dictionary invented here, wrong the first time a
  new word turned up. The panel prints every matched description instead. If
  he sees a match he disagrees with, that line is the evidence — send it.
- **The sign-in, reset and submit screens keep a second vocabulary** —
  `--primary` and `--bg` rather than `--steel` and `--paper`. They link
  `theme.css` so the menu is right, but folding their palette in would restyle
  three screens nobody asked about. Worth a decision, not a silent change.
