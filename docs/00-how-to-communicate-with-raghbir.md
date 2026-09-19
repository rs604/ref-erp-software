# How to communicate with Raghbir — read this first

Applies to every session in this project, and to every build chat.

---

## Rules

- **Bullet points only. No paragraphs.** He reads fast and paragraphs waste his
  time
- **Short and crisp.** Specific and limited, but enough to decide. Cut everything
  else
- **Layman language.** He has zero coding or backend knowledge and says so plainly
- **Explain any technical term in brackets the first time.** Example: "trigger
  (an action the system does by itself)". He called out not knowing what "party
  spine" meant
- **Don't offer multiple-choice menus.** He skips them. Make the call, state it in
  one line, say why, move on
- **Don't re-explain.** Say it once
- **Don't ask him to approve each file edit or each query.** Do the work and
  report what changed at the end of the phase *(set 11 Sep 2026)*
- **Ask first only before deleting a Supabase project or dropping a table.**
  Everything else short of that is yours to do *(set 11 Sep 2026)*
- **Say when you were wrong, plainly.** Several of his corrections have fixed real
  errors — the antivirus mapped as an asset, the vendor_type column that was not a
  duplicate, the fuzzy matching that would have flagged 801 false positives.
  He catches things. Treat that as useful, not awkward

## Writing documents for him

- Same rules. Bullets, plain words, no paragraphs
- **Always say why, not just what.** A rule without its reason gets changed back
  in a year. But state it in one bullet
- Tables where things compare

---

## Context that shapes everything

- Owner of **Raghbir Erectors & Fabricators**, Ludhiana, Punjab. About 100 people
- Conveyors, lifts, cranes, hoists, chains, electrical panels. Custom manufacture
- **"Ref Conveyors" was dropped entirely on 9 Sep 2026.** One firm, one GST, one
  number series. Older documents still using that name are out of date
- **He will not copy-paste anything, ever. Will not run commands.** Claude does
  all execution
- Hard requirement: the ERP must feel **live like Google Sheets** — no lag, no
  page refresh
- Simple enough for a new employee to learn quickly
- **360° view** — open a person or an item, see everything about them on one
  screen
- An accounting package is already in use. **The ERP does no accounting.** It
  exists so there is no loophole in the process and everything is traceable: who
  did what, when

---

## How a report comes back

**One code block. The whole report inside it. Nothing outside it except one
line saying which phase is done.**

He copies the report into the design chat. Plain text loses its formatting on
the way, and on a phone it takes several taps to select. A single fenced block
is one tap.

This was agreed and then slipped twice — two reports came back as plain text
— which is why it is written down here rather than remembered.

The rules about what goes *in* the report stand as before:

- **A report says what is live.** Anything not live is not done, and belongs in
  a BLOCKING section at the bottom, not in a footnote
- Do not head a report "done" and then mention further down that it was never
  merged

---

## How the work is split

- **This project's discussion chat makes no database changes.** Discuss → agree →
  write a prompt → a separate chat executes it *(set 26 Aug 2026)*
- **The discussion chat cannot see the build chats.** Build chats must save their
  reports into this project as documents, not only into their own conversation
- Every decision goes into a document **the same day**, not left in a chat

---

## Where things live

- **Code and documents** — GitHub `rs604/ref-erp-software`, `docs/` folder.
  GitHub is the master copy
- **Database** — Supabase `refcon-erp` = `deevokrufinihutrvnqw`, ap-south-1 Mumbai
- **This project** — copies of the same documents, so every chat reads them
- **Do not touch** `xxzoatpeoyktodvmjbks` (ref-conveyors-pm-tool). Separate system
