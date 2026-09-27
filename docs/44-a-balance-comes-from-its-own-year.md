# A balance comes from its own year

**Date:** 26 Sep 2026 · **Status:** on main, waiting on the reload
**Migrations 78 → 81**

---

## The fault Raghbir found

> "Ramson — we have not done any business, still it shows ₹50,000."

The rule underneath both `busy_ledger` and `busy_balances` was **the latest
opening at or before the date**. That reaches back through dead years until
it finds one. For RAMSONS TYRES it reached back to March 2016.

What actually happened in Busy: the ₹50,000 is an advance from March 2016
sitting on the **old spelling** of the name. When the ledger was renamed
RAMSON TYRES, Busy carried the ₹50,000 forward as the new ledger's opening,
and the new ledger then closed at zero. The old one was never touched again —
and the old rule kept finding it.

Six parties came back from the dead that way:

| Ledger | Showed | Last active |
|---|---:|---|
| RAMSONS TYRES | 50,000 | 2015-16 |
| GOEL SALES CORP. | 16,939 | 2023-24 |
| GLOBIZ TECHNOLOGY | 13,500 | 2018-19 |
| RALSON INDIA | 7,488 | 2015-16 |
| KAMAKHYA SOFT | 5,000 | 2017-18 |
| ARK ENGINEERINGH | 1,770 | 2023-24 |

## The rule now

**A balance at a date comes only from the financial year containing that
date** — that year's opening plus that year's movement up to the date.
Nothing from any earlier year. A party with neither reads NIL, because Busy
already carried forward everything that was not zero.

It holds everywhere a balance is shown. There are exactly two places that
compute one, and both were rewritten:

- `busy_balances` — debtors and creditors (migrations 78 → 80)
- `busy_ledger` — the ledger's opening and closing cards (migration 81)

The customer screen shows **sales value**, never a balance, so there was
nothing to change there. `busy_party_list` feeds the dropdown and returns no
figure. Nothing in `busy.html` computes a balance of its own.

### It keeps the ten opening-only parties, which is the point

> "They have a 2026-27 opening balance, so Busy carried them forward. That
> means the balance was not zero at 31 March."

The rule reads this year's opening row. A party that has one keeps its
balance whether or not anything has moved:

```
JASPO WORLDWIDE     2026-27 opening row  →  opening 2,00,000   closing 2,00,000   0 entries
JOGA SINGH & CO.    2026-27 opening row  →  opening 6,58,745   closing 6,58,745   0 entries
RAMSONS TYRES       no 2026-27 opening   →  opening 0          closing 0          0 entries
```

Verified against the live project, signed in as the owner, inside the 8s
budget. Both his figures to the rupee.

### And the frozen Hindon example does not move

`HINDON METAFORMS PVT.LTD` has its own opening row in every year, 2025-26
included, so the old example still reads opening ₹41,250 · closing ₹2,15,290
· 4 entries · 1 undated opening. Unchanged.

### The counts

At 26 Sep 2026, REF:

|  | with a balance | nil |
|---|---:|---:|
| Sundry Debtors | 35 | 222 |
| Sundry Creditors | 45 | 482 |
| **Total** | **80** | **704** |

**80, not 86** — his figure. The six dead-year parties are the difference.

The four totals, live, against the ones he sent:

```
Debtors    Dr 11 / 28,36,759.20     Cr 24 / 28,83,926.85
Creditors  Dr 38 / 65,14,968.00     Cr  7 /  1,91,120.04
```

The counts and the amounts are exactly his. The **Dr/Cr labels are still
mirrored** because the rows currently loaded were written by the old parser.
After his clear and reload they land the right way round: Debtors RECEIVABLE
24 / ₹28,83,927 Dr and ADVANCES RECEIVED 11 / ₹28,36,759 Cr; Creditors
PAYABLE 38 / ₹65,14,968 Cr and ADVANCES PAID 7 / ₹1,91,120 Dr.

## The four migrations, and the two that did not work

**78 — `a_balance_comes_from_its_own_year`.** Built the answer in a temporary
table. `CREATE TABLE is not allowed in a non-volatile function`. Marking the
function VOLATILE to suit the shortcut would have been the wrong way round:
it reads and never writes, and saying so is what lets Postgres plan it.

**79 — `one_statement_no_temporary_table`.** One statement instead. It timed
out. `sided` is read three times — the rows with a balance, the nil rows, the
totals — and since Postgres 12 a CTE referenced more than once is **inlined**,
so a `DISTINCT ON` over 74,000 ledger rows and a `max(vch_date)` over all of
them ran three times each.

**80 — `the_cte_is_computed_once`.** `as materialized`. Compute it once, keep
it, three readers share one pass — which is what the shape of the query always
meant. Inside the budget.

**81 — `the_ledger_opening_comes_from_its_own_year`.** The same rule in
`busy_ledger`. It also scopes the undated-opening count to this year (it was
counting every undated opening row in eleven years, a number about nothing)
and adds `crosses_years`, so a range that spans 1 April says so instead of
quietly presenting a multi-year running balance as a year-end one.

All four files are in `supabase/migrations/` and each is md5-verified against
the fingerprint the database itself holds.

## The ledger note that was lying

The old screen said *"Busy has no opening balance for this party in 2026-27.
The opening above is carried forward from 2015-16."* There is no carrying
forward any more, and the key that note read (`anchor_fy`) no longer exists —
which meant its fallback, *"Busy has no opening balance for this party at
all"*, was about to fire on **every** ledger, Hindon included. Both are
replaced with what is now true.

## Two sections, and nobody in both

**Section 1 — parties with a balance.** Unchanged in substance: the side the
screen is about first (RECEIVABLE on Debtors, PAYABLE on Creditors), the
advance second and never netted into it, biggest first inside each side. The
four cards stay above it and belong to this section only.

**Section 2 — NIL BALANCE.** Every party in the group, **across all years**,
whose balance today is exactly zero. Party · last transaction · days since,
sorted by last transaction, most recent first. No cards and no totals — a
total of nothing is nothing.

- The balance column says the word **NIL**. Not `0`, which reads as a
  rounding of a real figure, and not blank, which reads as data that failed
  to load.
- **A party is never in both.** A balance of one rupee is a balance and
  belongs above; only exactly zero is below. Asserted in the tests.
- The same search box filters both, so typing a name answers *"have we done
  business with them?"* whether or not they owe anything. Typing `ramson` now
  finds RAMSONS TYRES in section 2 while section 1 says plainly that it has
  nobody by that name.
- Sorted by last transaction it is the dormant-customer call list. Newest is
  MADHAV FABRICS, 15 Sep 2026; oldest is RIGHT SEEDS PVT. LTD, 25 Apr 2015.
- On a phone: section 1 as cards, section 2 as a plain list. A card is for a
  figure you weigh against the one below it; the nil list has no figure, so a
  card there is an empty frame around a name and eighty of them is a wall.
- The PDF and the Excel carry both sections. A printout that drops the nil
  list makes a dormant customer look like one who never existed.

## The 12px floor, everywhere

> "Not phone only. A desktop screen is read for hours, and 11px on a 24-inch
> monitor is still 11px."

`phone.test.js` has held this floor at 380px for a while. The desk never did.
**Sixty-one** declarations were below it and are now at 12px:

- **busy.html, 12** — `.kpi .k` (the heading on every card, 10.5px),
  `label.fl` (every control label, 10.5px), `.kpi .way`, `.drcr-sfx`,
  `.topbar-sub`, `.sync-stamp`, `.sub`, `.missing`, `.method`,
  `.shortcut-hint`, `.colmenu-note`, and a 10px percentage inside a bar
- **admin.html, 44** — `.status-tag` at 10px, `CARRIED` and `TEST` tags at
  9px, `.role-tag` and `.perm-emp-access` at 9.5px, `.pg-emp-inc` at 9.5px,
  every `.field label`, the mobile `td::before` labels, and twenty inline
  sizes in generated rows
- **index.html, 2** and **submit.html, 3**

I found twenty-six of them by grep and missed the rest, because thirty-five
were written as `10.5px`, `11.5px` and `9.5px` and my search was for whole
numbers. What found them was the runtime check below, reading the computed
size off the page — which is the right way round and is now what guards it.

The floor is **checked on every screen the sweep walks, at both widths**,
rather than only at 380px, so the next 11px is caught where it is written.

**The print stylesheets are left alone**, on purpose. Nine sizes of 10–11px
remain inside the `window.open` sheets for the ledger PDF, the balances PDF,
the salary slip and the letterhead. Those are paper, where 11px is normal
body text and the argument for the floor — a screen read for hours — does not
apply. Say the word and they go up too.

## The signature snapshot can now be proved, not just re-saved

`check-rpc-calls.js` refuses to pass when a migration file is newer than
`rpc-signatures.json`. But that test is a **file date**, and a file date is
cleared by saving the file whether or not anyone compared it with the project.

The snapshot now carries `_fingerprint`: the md5 the database computes over
the same 51 functions. Re-taking it means running one query and matching a
number. The four new migrations changed no signature at all — `busy_balances`
is still `(p_company, p_group, p_on)` and `busy_ledger` still
`(p_company, p_party, p_from, p_to)` — and the fingerprint proves that rather
than asserting it.

## The test stub lied about the group, and now does not

`rpc:busy_balances` answered **both** groups with the debtors fixture, so the
Creditors screenshot drew the debtors' rows, in the debtors' order, under the
creditors' headings — and agreed with itself. The stub now echoes `p_group`
and re-sorts section 1 the way the database sorts it. That is the fourth time
a stub has flattered a picture on this screen; the pattern is always the same,
and the fix is always to make the stub behave like the server.

## Two faults found in the tests themselves

**`check-signs-live.sql` could not run.** `busy_ledger` and `busy_balances`
ask `is_owner()`, which reads `auth.uid()`, which reads the JWT claims — and
a psql session has no signed-in person, so every call in that file was
refused with *"You do not have permission to see Busy data."* It now borrows
the owner's identity for the length of the session, looked up by role rather
than carried as an id in a public repo. It also asks for the two lists in two
statements instead of one: each takes several seconds over 74,000 rows, and
the pair in one statement goes past the budget the screen itself has. And it
now checks the year rule — RAMSONS TYRES 0, JASPO WORLDWIDE 2,00,000, JOGA
SINGH & CO. 6,58,745, all three sign-independent, so they hold before the
reload as well as after. Run against the live project: three PASS.

**`admin-permissions.test.js` had stopped running.** Since *one module open
at a time* landed, a cold load of admin.html opens only the first module
holding a screen of that page, and Permissions is not in it — so the test's
`waitForSelector` waited for a button that is deliberately folded away, and
died on a 30-second timeout instead of running its 28 assertions. It waits
for *attached* now, which is what it meant. This was already broken on main
and is not from this work.

## What is still waiting on him

The clear and both uploads, then `tests/check-signs-live.sql`. Until that runs
the Dr/Cr labels on this screen are mirrored, for the reason above — the
amounts and the counts are already right.
