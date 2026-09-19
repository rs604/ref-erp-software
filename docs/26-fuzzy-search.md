# Fuzzy search — why it was not working, and what it does now

Raghbir typed `junja` and did not get JUNEJA. He typed `junejpipe` and got
nothing at all. The search was locked as three layers — exact, then cleaned,
then fuzzy — and only the first two were doing anything.

---

## The direct question he asked

> "The second may need its own handling: if a word matches nothing, try
> splitting it. Tell me whether that is what you build or whether fuzzy alone
> covers it."

**Fuzzy alone cannot cover it, and here are the numbers.** Measured on his own
data before anything was changed:

| Comparison | Trigram similarity | Edit distance |
|---|---|---|
| JUNEJA / JUNJA | 0.444 | 1 letter |
| AGGARWAL / AGARWAL | 0.700 | 1 letter |
| JUNEJA / JUNEJPIPE | 0.417 | 4 letters |
| PIPE / JUNEJPIPE | 0.250 | 5 letters |

A typo is one letter out. Two words run together is four or five letters out.
No single threshold separates "the same word, badly typed" from "two words with
no space", because the second is not a spelling mistake at all. **So splitting
is built as its own handling, as a fourth layer below fuzzy.**

---

## Why `junja` failed

The fuzzy test was `similarity(row_word, query_word) > 0.5`.
`similarity('JUNEJA','JUNJA')` is **0.444**. One dropped letter in a six-letter
name scores below the gate, so the layer never fired.

Raising the gate does not work either. `similarity('SHEET','SHEEL')` is
**0.500** — *higher* than the typo we want to catch. Trigram overlap cannot
tell those two apart in the right direction, so it is the wrong instrument.

**Edit distance is the right one.** JUNEJA/JUNJA is one letter. AGGARWAL/
AGARWAL is one letter. The allowance is set by word length:

- under 4 letters — no guessing at all, at that length everything is near
  everything
- 4 to 6 letters — 1 letter out
- 7 letters and over — 2 letters out

## Why `junejpipe` failed

Nothing was looking for it. The fuzzy layer was also switched off entirely
whenever the query held any number, which was stricter than the locked rule.

**A word the data does not know is now cut in two.** Every cut leaving at least
three letters on each side is tried, and a cut is accepted only when the data
has **both** halves, as written:

```
JUNEJPIPE   JUN|EJPIPE   EJPIPE is not in the data        rejected
            JUNE|JPIPE   JPIPE is not in the data         rejected
            JUNEJ|PIPE   both present                     accepted
            JUNEJP|IPE   JUNEJP is not in the data        rejected
```

The word being cut is allowed to be a near spelling. The halves are not: a
guess on top of a guess is not worth offering. (The first build of this let
JPIPE through because it is one letter from PIPE, and cut the word in the
wrong place. Migration 59 closed that.)

The question is asked **once per search, of the word** — not of every row. The
vocabulary of REF's own history is 3,721 words; the answer comes from those,
and then the search runs once on the rewritten words.

---

## The rule that did not bend

> "NUMBERS AND CODES MUST MATCH EXACTLY before anything is offered.
> Fuzzy applies to WORDS, never to numbers."

Any typed word carrying a digit is matched character for character. It is never
fuzzed, never split, and never offered as half of a split. On top of that, the
older whole-number test still gates **every** layer: each number in the query
must appear in the row as a number in its own right, not as part of a longer
one.

## Saying which kind of match it is

> "A fuzzy match must never be presented as an exact one."

Every row now carries which layer answered it, and the screen has a **Match**
column:

| Shown as | Layer | Tinted |
|---|---|---|
| Exact | the words appear as typed | no |
| Spacing | same words, different spacing or punctuation | no |
| Spelling | a close spelling — a guess | yes |
| Split | words typed run together — a guess | yes |

With nothing typed the column is blank: there is nothing to be right or wrong
about. The line under the table says how many of the rows on screen are
guesses. The column can be hidden like any other, and the choice is remembered
for that person.

---

## The four tests he asked for

Run against the live project, as the signed-in owner, with the same 8-second
limit a real session has. REF, 21,470 item rows.

| Typed | Asked for | What came back | Shown as |
|---|---|---|---|
| `junja` | should find JUNEJA | **1,425 rows** — JUNEJA IRON STORE, JUNEJA ISPAT, JUNEJA STEEL SALES | Spelling |
| `agarwal` | should find AGGARWAL | **136 rows** — AGGARWAL PIPES & STRUCTURES, SK AGGARWAL & CO | Spelling |
| `junejpipe` | should find JUNEJA + PIPE | **619 rows** — JUNEJA IRON STORE and JUNEJA STEEL SALES, pipe lines only | Split |
| `80x40x3` | must NOT return 80X40X2.5 | **4 rows**, every one a real 80×40×3 | Exact / Spacing |

`junja` returns exactly the same 1,425 rows as typing `juneja` correctly.

On the last one: there **are** three 80X40X2.5 rows in the data, and none of
them came back. The test is a real one, not a test that passes because there
was nothing to fail on.

The count under the pager was checked against the rows for all four: 1,425 /
136 / 619 / 4. They agree, because the count and the rows go through the same
two functions rather than through two copies of the same rule.

---

## Speed, because the first fix was too slow to ship

The first build gave the right answers in **12.0 seconds**. A signed-in person
gets 8. That would have been a working search that timed out.

Two things were wrong, and both are worth remembering:

1. **Every search took all 21,470 rows apart from scratch** — 538ms of
   normalising and compacting the same text, every time. That work now belongs
   to the row: `search_norm`, `search_comp` and `search_words` are generated
   columns the database keeps, so no import and no caller can forget them.
2. **The split was being decided row by row** — four cuts, eight halves,
   21,470 times, for a question that has one answer per word.

And one more found by measuring rather than reasoning: the search was calling
`busy_compact` on the **typed** word once per row. Same word, same answer,
21,470 times.

| Typed | Before | After |
|---|---|---|
| `agarwal` | 12.0s | **0.79s** |
| `junejpipe` | 3.45s (after the first fix) | **1.35s** |

---

## What this is made of

| Migration | What it does |
|---|---|
| 57 | edit distance instead of trigrams; splitting; match_tier 0–4 |
| 58 | `search_norm` / `search_comp` / `search_words` on the row; splitting decided once per word |
| 59 | a half of a split must be a word the data actually has, as written |
| 60 | the typed word is compacted once, not once per row; fuzzy skipped after a split |

| Function | What it answers |
|---|---|
| `busy_near(a, b)` | are these two words the same word badly typed? |
| `busy_word_matches(words, comp, word, compacted)` | does one typed word match one row? |
| `busy_split_query(company, words)` | rewrite the typed words, cutting one the data does not know |

Both `busy_search` and `busy_search_count` go through the same three, so the
count cannot drift away from the rows it counted.

---

## Tested

- `sh tests/run-all.sh` — **187 of 187** on busy.html, **28 of 28** on the
  permission screen, every page in the set agreeing, no test reading a cell by
  position.
- **24 of 24** database call sites resolve against the project itself, checked
  with `tests/check-rpc-live.sql` after the migrations.
- The call-site reader now follows a variable holding an object literal and
  `Object.assign` of them, so the two Price History calls — the ones that got
  the arguments wrong twice before — are checked rather than reported as
  unreadable. Proved by breaking `p_offset` on purpose and watching the check
  fail.
- New browser tests: the Match column exists, an exact match says Exact, a
  close spelling says Spelling and is tinted, run-together words say Split and
  are tinted, the two real matches are not tinted, and with nothing typed no
  row claims to be a match of any kind.
