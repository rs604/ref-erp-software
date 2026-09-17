# Change — Description on an item

**Date:** 13 Sep 2026 · **Status:** done, applied to Mumbai, pushed
**Migration:** `26_item_description_vs_remarks`

---

## You asked me to check first. I did

- **`items.description` already existed.** It came over in the Tokyo port,
  migration 07, on 9 Sep
- It is `text` and optional — so it is already multi-line and already not
  mandatory. Nothing about it needed changing
- **It was kept, not replaced and not re-added**

| Column | Type | Optional? | Multi-line? |
|---|---|---|---|
| `items.description` | text | yes | yes |
| `items.remarks` | text | yes | yes |

`remarks` was added in Phase C. Both already existed and both were already the
right shape.

---

## What was actually missing

- **Neither column said what it was for.** Both were undocumented
- Two empty text boxes sitting next to each other is exactly how somebody types
  a note meant for our own people into the box that prints on the PO and goes
  to the vendor
- So the change is a written difference, held in the database itself, not a new
  column

**Now recorded against the columns:**

- **`description` — PRINTS.** The specification, shown on the PO under the item
  name, and what the PO screen's Specification column reads. Optional,
  multi-line. Nothing internal goes here
- **`remarks` — NEVER PRINTS.** Internal notes for our own people only
- **`name`** also got a note saying the specification is `description`, not part
  of the name, so nobody starts padding the item name instead

**Why bother:** a rule with no reason gets changed back in a year. Now the answer
travels with the database, and anyone — or any future chat — reading the table
sees it without needing this document.

---

## One thing worth your answer

- The PO's Specification column **reads the item's description live**
- So editing an item's description later would also change how a PO **already
  sent to a vendor** prints
- Everywhere else in the PO this was deliberately avoided: `po_terms` and
  `po_annexures` each keep the PO's **own copy**, so a sent PO never changes
  underneath it
- Two choices, and it is yours:
  - **Leave as is** — simplest, and the specification always shows today's truth
  - **Snapshot it onto the PO line** — the sent PO stays exactly as sent, which
    matches how terms and annexures already behave
- I did not build the snapshot, because you asked for the field, not a change to
  how POs print. Say the word and it is a small addition

---

## Checks

- Nothing dropped, nothing rebuilt. No new table, no new column
- Migration file in GitHub verified by fingerprint against what actually ran
- Table and policy counts unchanged: **81 tables, 218 policies**
