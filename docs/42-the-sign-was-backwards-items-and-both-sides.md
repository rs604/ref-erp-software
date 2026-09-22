# The sign was backwards, the item master, and both sides

**Date:** 21 Sep 2026 · **Status:** live on main · **Migrations 74, 75, 76**

---

## 1 · The sign — the ERP needed no change, and that is the point

Parser `2026.09.21-mdbtools` pulled and merged. The fix is two lines, on the
ledger rows and the opening rows:

```
-  debit=v if v>0 else 0, credit=-v if v<0 else 0,
+  debit=-v if v<0 else 0, credit=v if v>0 else 0,
```

**Nothing in the ERP compensated for the old convention, and nothing has been
changed to compensate for the new one.** `busy_ledger` is `debit - credit`
throughout; `drcr()` calls a positive balance Dr. That is plain accounting and
it is right exactly when the rows are. A correction on this side would have
been a second place for the sign to be wrong.

Verified against the live database, which still holds the OLD rows — so a
flip is a negation, and negating today's answer must give yours:

```
JUNEJA STEEL SALES 2026-27   live 1,554,211 Dr  → flipped 1,554,211 Cr   ✓ yours exactly
HINDON 2026-27                live   215,290 Dr  → flipped   215,290 Cr
```

### AKSON WILL NOT READ ₹9,97,050 AFTER THE RELOAD — please check this before clearing

Akson is the balance the fault was found from, so it matters that it lands
right. In the currently-loaded data Akson has **three** rows in 2026-27:

```
2026-05-12  Sales Invoice   credit 2,83,200
2026-05-18  Receipt          debit 2,00,000
2026-07-24  Receipt          debit   83,200
                                    ─────────
                             net          0
```

They net to **zero**, and a sign flip is a negation — `-0` is still `0`. There
is no ₹9,97,050 anywhere in Akson's rows; the largest single figure is
₹2,83,200.

You also said the new file has **the same counts as before**, and it does —
today's load is already exactly `21,470 · 1,432 · 67,763 · 6,532 · 1,065 ·
382 = 98,644`. Same counts and same keys means the same vouchers. Both of
these cannot be true at once:

- the rows are the same and only the values flip, **and**
- Akson goes from ₹0 to ₹9,97,050 Cr.

So either the new export contains vouchers this one does not (in which case
the counts are a coincidence worth re-checking), or the 9,97,050 came from a
different ledger or a different year. **Clearing is destructive and takes a
re-upload of 98,644 rows to undo**, so it is worth one look at Akson in Busy
first. Everything else in your reload plan is unaffected and I would run it.

### The test that checks the SIDE

> The Hindon check passed only because it compared the amount, never the side.

Six assertions now, and none can be satisfied by an amount alone:

```
an advance received is a CREDIT, not a debit — the side, not the amount
and its amount is right too, which is all the old check asked
a party who owes us reads Dr on the same screen
the advances received are counted on their own, not netted away
and what is owed to us is its own figure, on the other side
clicking a party opens their ledger
```

---

## 2 · Items — Busy Data → REF → Items, and under RS

`busy_items`, keyed on company + item_code. `fy` is the **latest** year the
item was seen, never moved backwards by a re-upload of an older file, so a
dead item stays visibly dead.

- **Columns:** Item · HSN · Unit · Alt unit · Tax category · Busy group ·
  Last seen.
- **Search covers the name AND the HSN** — typing `8431` finds everything
  under it.
- **NO HSN in amber**, **a slab that no longer exists in red**, with
  *12% and 28% were abolished on 22 September 2025* in the tooltip. Both are
  counted in chips at the top, and each chip is a filter as well as a number.
- **The clean unit is shown; Busy's own spelling is the tooltip** — and only
  where the two differ. `PCS` is `Pcs` in capitals, not a different spelling,
  so it gets no tooltip; `Pcs.`, `NOS` and `Metres` do.

**Nothing is merged on the ERP side.** The cleaning is one table in the
parser, `UNIT_CLEAN`, checked against your list:

```
Pcs. · PCS · NOS → Pcs      Set · SET → Set        Metres · Metre → Metre
Roll · ROLL → Roll          FEET · FOOT → Feet     unknown → passed through
```

**Upload:** `busy_items.csv` goes through Load history as you asked. The
screen recognises it **by its columns** — an `item_code` and no `kind` —
rather than by its filename, so renaming a file cannot send 2,897 items into
the voucher table. It is upserted, not staged-and-compared, because a master
list has no year to compare; every chunk is an upsert, so a retry is safe.

**Parser:** `parse_items()` added as its own function — `MasterType = 6`, HSN
from `HSNCode`, unit `CM1`, alternate `CM2`, tax category `CM8`, group
`ParentGrp`, each looked up by code in Master1. Run it with
`busy_parser.py <file> <company> <fy> items`.

**I could not test `parse_items()`** — there is no Busy file here, and the ERP
never opens one. `clean_unit()` is unit-tested against your list and passes;
the Master1 field names are from your message, not from a file I have read.
The 2,897 / 2,438 / 459 counts are likewise yours and unverified until the
upload lands.

---

## 3 · Debtors and Creditors — both sides, never the net

Four cards, the two sides never added together, and the side the screen is
**about** leads: on Debtors what they owe us, on Creditors what we owe them.
A note under the cards says in words why:

> Both sides are shown and never netted away. On capital goods an advance is
> normal — 50% on order, before the machine is billed — so **₹28,36,759** is
> customers who have paid for machines not yet delivered. A single net figure
> would hide it.

Party · Balance · Dr/Cr · last transaction · days since, biggest first.
Clicking a party opens their ledger. Date range with Today / End of this FY /
End of last FY / Custom, the same shape as every other report. PDF and Excel
on the same letterhead and with the same footer as the ledger.

### Your four totals against mine

Mine are computed from the live rows with the flip applied. They are close
but not equal, in the same direction as the Akson gap — a few more parties
and a little more money in every bucket:

```
                              yours                    mine (today's rows, flipped)
DEBTORS   owe us (Dr)          24  ₹28,83,927           27  ₹29,44,514
          advances (Cr)        11  ₹28,36,759           12  ₹28,86,759
CREDITORS we owe (Cr)          38  ₹65,14,968           39  ₹65,31,907
          advances paid (Dr)    7   ₹1,91,120            8   ₹2,04,620
```

Every one of mine is higher, which is what a slightly larger voucher set looks
like. **Re-run the screen after the reload and these should land on yours.**
If they do not, the definition is worth arguing about and the numbers are on
the screen to argue with.

---

## What the tests hold

```
admin-permissions  28/28     nav       64/64
busy              255/255    phone    162/162
cold-open         108/108    sweep     60/60
check-live: 12 shipped files · what main serves is what is in the repo
```

Migrations, each md5-verified against the database's own fingerprint:
`74` `6841149dddcdae810ffd5a22f705f656` · `75` `bc0afa588077ff84d9d9ac8380d7a0f5`
· `76` `150c52166b7da723b57892f06bd950c7`.

**76 exists because 75 was too slow.** Picking each party's group with a
correlated subquery meant 1,300 ordered scans and the whole thing ran past the
8-second budget the `authenticated` role is given. The DISTINCT ON above it
had already found the latest row for every ledger and simply threw the group
away.

### Three faults the phone sweep and the pictures found

- **The page scrolled sideways on Debtors at 380px.** `.kpis-4 .v` is
  `nowrap`, and a grid item will not shrink below its content unless told it
  may — so `₹12,88,000 Dr` held its column open and pushed the page 5px over.
- **`.way` was 11px**, under the 12px phone floor. That is the PAYABLE /
  RECEIVABLE line and the party count.
- **Then the fix for the first broke "Cr" into "C" and "r"** across two lines,
  which the next screenshot showed. The nowrap belongs on the suffix, not on
  the card: the figure never breaks (there are no spaces inside 12,88,000);
  only the Dr or Cr after it may drop a line.

Also: "PARTIES ₹4" — `kpi()` put a rupee sign on a count.

---

## Still open

- **Akson**, above. Worth a look before clearing.
- **The customer list still has no near-duplicate-name flag**: R S INDUSTRIES
  · NATIONAL INDUSTRIES · RALSON (INDIA) · SETH INDUSTRIAL CORPORATION show
  as two rows each.
- **The 12px floor at a desk** — phone rule only, or everywhere?
