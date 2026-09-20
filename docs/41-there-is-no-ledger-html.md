# There is no ledger.html

**Date:** 20 Sep 2026 · **Status:** live on main · **Migration 73**
`73_a_note_that_fires_on_one_result_is_worse_than_no_note`

---

## The file does not exist, and never has

> DELETE ledger.html. Do not leave it.

There is nothing to delete. Checked four ways:

```
1. the working tree     five .html files: admin · busy · index · reset · submit
2. every commit ever    git log --all --diff-filter=A → no ledger.html,
                        on any branch, in any commit in this repository's history
3. every remote branch  git ls-remote → refs/heads/main and the working branch.
                        No gh-pages, no second deploy source.
4. what is SERVED       raw.githubusercontent…/main/ledger.html → 404
                        raw.githubusercontent…/main/busy.html   → 200
```

There is also no test for it — nothing in `tests/` mentions `ledger.html`. The
test you are thinking of is `cold-open.test.js`, which opens each of the five
real pages with no session.

**A bookmark to `/ledger.html` already 404s.** That is the answer you wanted,
and the site is already giving it.

## But the gap you are describing is real, so it is closed now

> A disabled tab protects the person who came through the menu; it does
> nothing for the person with an old bookmark or a link in a WhatsApp message.

That is right, and nothing in the ERP was checking it. `check-page-set.js`
discovers pages by looking for the ones that load `app-config.js` — so a page
dropped from the menu but left on disk was invisible to every check while
still being served, still signing people in, and still answering.

New rule, which fails the build:

```
every .html in the repository is reachable from the menu, or is one of the
two doors that cannot be (index.html to sign in, reset.html to set a
password). Anything else is an orphan.

  FAIL  ledger.html is in the repository but nothing in the menu points at
        it. It is still served to anyone with the address — delete the
        file, or give it a menu entry
```

Proved by putting a copy of `busy.html` at `ledger.html`, running the check —
that message was the only failure — and removing it again. The file set is
back to five.

So if a page like that is ever added, or a screen is ever dropped from the
menu and left behind, the check says so and names the remedy in your words:
delete the file.

---

## The note that could have said "1 ledger"

> A note that fires on a single result is worse than no note — it teaches
> people to ignore the note, and then they ignore the real one.

The note could not say "1" — it is drawn only when there is at least one
*other* ledger, so the count starts at 2. But there was a way for it to
**overstate**, which is the same fault wearing a different number.

`busy_similar_ledgers()` answered for any string at all, including one Busy
does not hold. Typing a third spelling — `R.S. INDUSTRIES`, with a space —
returned **both** real ledgers, and the screen said:

```
2 ledgers with nearly the same name … This one is R.S. INDUSTRIES
```

over an empty ledger, counting a ledger that does not exist as one of them.

Migration 73: the ledger asked about must itself exist in that firm, or the
function returns nothing and the screen prints nothing. Checked live:

```
R S INDUSTRIES            → 1 other    note says 2 ledgers
R.S.INDUSTRIES            → 1 other    note says 2 ledgers
R.S. INDUSTRIES  (typed)  → 0          no note     ← was 2
HINDON METAFORMS PVT.LTD  → 0          no note
ZZZ NOT A LEDGER          → 0          no note
```

Two assertions pin it, one for each way a note can fire on one result:

```
no note at all for a ledger with no twin — one is not a finding
no note at all for a name Busy does not hold — one is not a finding
```

Proved by removing the guard from the test stub: the second failed with
`2 ledgers with nearly the same name … This one is R.S. INDU…`, and the file
was restored byte-exact (md5 checked).

md5 `fd5d2868b932f676d122a03ea3272589`, verified against the database's own
fingerprint.

---

## What the tests hold

```
admin-permissions  28/28     nav       64/64
busy              238/238    phone    153/153
cold-open         108/108    sweep     51/51
check-live: 12 shipped files · what main serves is what is in the repo
```

---

## Still open

- **The customer list has the same duplicate-name problem and no flag.** Four
  pairs show as two rows each: R S INDUSTRIES · NATIONAL INDUSTRIES · RALSON
  (INDIA) · SETH INDUSTRIAL CORPORATION.
- **The 12px floor at a desk** — phone rule only, or everywhere?
