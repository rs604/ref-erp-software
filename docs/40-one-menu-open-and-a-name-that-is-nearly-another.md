# One menu open, and a name that is nearly another name

**Date:** 20 Sep 2026 · **Status:** live on main · **Migration 72**
`72_three_ledgers_one_customer`

---

## First — the ledger tab in admin.html does not exist

You asked me to grey it out. I looked for it and there is nothing to grey.

`admin.html` has nine screens: Home, Km Tracker, Employee Master, HR
Dropdowns, Vendor Master, Users & Permissions, Decisions, Salary Calculator,
Loans & Advances. **None of them is a ledger screen**, and none reads Busy
data. The only Ledger entries anywhere in the ERP are the two in `nav.js`
pointing at `busy.html` — the ones built last week.

What is in `admin.html` and might read like one:

- **`table.ledger`** — a CSS class, used by fourteen tables (loans, the salary
  sheet, HR dropdowns, employees). It is a style, not a screen.
- **Loans & Advances**, whose page subtitle is "Employee loan and advance
  ledger". That is the *employee* loan book, it reads a table that is very
  much still loaded, and the salary sheet posts deductions to it. Greying it
  out would take a working screen away.

So I have changed nothing here rather than disable the wrong screen. **If you
meant one of those two, say which and it is a two-minute job.** If you were
looking at an older build, the screen is already gone.

---

## The duplicate names — your instruction is right, your examples are not

This matters because you said you would take it to your accountant.

**The three you named are not in the data.** Checked against every ledger in
both firms:

```
HERO CYCLE LIMITED / HERO CYCLE LIMITED. / HERO CYCLES LIMITED
   → no such ledgers. What exists is HERO CYCLE LTD. (75 entries),
     HERO MOTORS LIMITED (67), HERO MOTORS LIMITED (DADRI) (31),
     HERO ECO TECH LTD. (58), HERO STEELS LIMITED (8) — five
     different Hero companies, not one written five ways.

MAGMA → MAGMA BIKES (12) · MAGMA CYCLES (17) · MAGMA IMPEX PVT. LTD (24).
        Three different names. They may well be one customer, but that is a
        judgement about the business, not a spelling difference.

YANMAR → ONE ledger. YANMAR AGRICULTURAL MACHINERY INDIA PRIV. No duplicate
         at all.
```

**And the real list is fifteen pairs, not eight.** These are the ones where
the names differ only by spacing, punctuation or a plural — which is to say,
certainly the same party:

```
REF   AUDIT FEE PAYABLE            AUDIT FEES PAYABLE
REF   C L SALES AGENCIES           C.L.SALES AGENCIES
REF   CEOITBOX TECH SERVICE LLP    CEOITBOX TECH SERVICES LLP
REF   GURU ANGAD IRON STORE        GURU ANGAD IRON STORES
REF   HANS RAJ RAM KISHORE         HANS RAJ RAM KISHORE.
REF   INVENT INFOTECH PVT. LTD.    INVENT INFOTECH PVT.LTD.
REF   J S ENGINEERS                J.S. ENGINEERS
REF   NATIONAL INDUSTRIES - UNIT - III   NATIONAL INDUSTRIES (UNIT-III)
REF   R S INDUSTRIES               R.S.INDUSTRIES          ← your own RS
REF   RALSON ( INDIA ) LIMITED.    RALSON (INDIA) LIMITED
REF   RAMSON TYRES                 RAMSONS TYRES
REF   SETH INDUSTRIAL CORPORATION  SETH INDUSTRIAL CORPORATIONS
REF   ZEST TECHNICAL SOLUTION      ZEST TECHNICAL SOLUTION.
RS    SKG ENGINEERING COMPANY      SKG ENGINEERING.COMPANY
RS    VAT PROCESSING FEE           VAT PROCESSING FEES
```

All fifteen are pairs. None is a trio. **That is the list to take to him** —
and it is a better list than the one you had, because every line on it is
beyond argument.

### One more thing worth his time

Eleven ledger names are **exactly 40 characters long**, which is Busy's own
ceiling for the field. They are cut off mid-word:

```
YANMAR AGRICULTURAL MACHINERY INDIA PRIV
SHIVA ALUMINIUM EXTRUSION PRIVATE LIMITE
SUPOMO TRADING & MANUFACTURING INDIA PVT
R & D CENTRE FOR BICYCLE & SEWING MACHIN
RESEARCH & DEVELOPMENT CENTRE FOR BICYCL      ← almost certainly the same
                                                organisation as the line above
```

Two long names could one day truncate to the same 40 characters and become
one ledger by accident. Not urgent; worth him knowing.

---

## What the screen does about it

Exactly what you asked and nothing more. Under the four cards, above the
entries:

```
2 ledgers with nearly the same name — balances are separate in Busy.
This one is R S INDUSTRIES; the other is:

   [ R.S.INDUSTRIES  5 ]

Adding them together is a correction to make in Busy, not here.
Nothing on this screen has been merged.
```

**Nothing is merged.** The figures on screen are one ledger's, and a test
asserts it. The other names are tappable, so checking the second balance is
one tap rather than a retyped name.

### The rule, and what it deliberately does not catch

Spacing, punctuation, a plural. Nothing else.

It does **not** join `HERO MOTORS LIMITED` to `HERO MOTORS LIMITED (DADRI)`,
or `MAGMA BIKES` to `MAGMA CYCLES`, or `R & D CENTRE FOR BICYCLE…` to
`RESEARCH & DEVELOPMENT CENTRE FOR BICYCL…` — even though that last pair
almost certainly is one organisation. A rule loose enough to catch it would
also join Hero Motors to Hero Motors Dadri, and then the flag is noise and you
stop reading it. Punctuation is a fact; spelling is a judgement.

`busy_name_key()` and `busy_similar_ledgers()`, migration 72, md5
`5de9627d4fd57f494fa5fbda01a914cb`, verified against the database's own
fingerprint.

---

## The left nav — one menu open at a time

Every module holding a screen on the current page used to open itself, so
`admin.html` opened HRMS, Masters and Settings at once and the list ran off
the screen.

- **Opening one collapses every other.** Not stack.
- **Remembered per person** — keyed on the signed-in person's id, in its own
  `refnav.module.<id>`, beside the firm one from last week.
- **Where you are beats where you were.** On arrival the remembered module
  opens; then the screen actually showing overrides it, so the item you are on
  is visible and highlighted. Opening another module does collapse the one you
  are in — that is what "only one open" means — but the highlight stays, so
  when it reopens it is obvious where you are.
- REF and RS inside Busy Data already worked this way and still do, one level
  down.

```
the menu has several modules with sub-items       Busy Data · HRMS · Masters · …
exactly ONE of them is open on arrival
opening one collapses whatever else was open      Masters open · HRMS shut
and the collapsed one has no rows left on screen
the choice is stored against the person
and next time it opens the module he used last
the screen he is on is highlighted, its module is the open one
```

---

## Two faults the pictures found, both in the tests rather than the page

- **The note named the wrong party.** The screenshot showed "This one is
  HINDON METAFORMS PVT.LTD" over R S INDUSTRIES' figures. The page was right;
  the test stub answered with the fixture's party whatever it was asked. It
  echoes the party now.
- **The note appeared for every party.** The stub returned the
  near-identical-name list regardless, so a flag about R S INDUSTRIES sat over
  HINDON's ledger and pushed the first entry off the first screen — which the
  "first ledger entry is visible without scrolling" assertion caught. The stub
  applies the real rule now, the same key the database builds.

Both are the same lesson as the `p_query` fix last week: a stub that answers
the same thing whatever it is asked will flatter a screenshot.

---

## What the tests hold

```
admin-permissions  28/28     nav       64/64
busy              236/236    phone    153/153
cold-open         108/108    sweep     51/51
check-live: 12 shipped files · what main serves is what is in the repo
```

---

## What is still open

- **The customer list has the same problem and no flag yet.** Four pairs show
  up as two rows each in Items/Customers: R S INDUSTRIES · NATIONAL INDUSTRIES
  · RALSON (INDIA) · SETH INDUSTRIAL CORPORATION. Adding two rows together
  there is the same mistake as adding two balances. Not built, because you
  asked for the ledger — say the word.
- **The ledger tab in admin.html**, as above.
- **The desktop font floor** — still one word from you: does the 12px floor
  apply at a desk, or only on a phone?
