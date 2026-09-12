# Phase D — the purchase module tables

**Date:** 12 Sep 2026 · **Status:** done, applied to Mumbai, pushed
**Schema only. No screens.** Built from doc 09.

---

## What was built

- **29 new tables · 3 migrations · 84 new security policies · 4 derived views**
- Applied to Mumbai and verified. All three migration files are in GitHub,
  pulled from the database's own record and checked by fingerprint

| | Before | After |
|---|---|---|
| Tables | 52 | **81** |
| Security policies | 134 | **218** |
| Permissions | 35 | **59** |

---

## The rule that is most often built the wrong way

**Bill rate must EQUAL the PO rate. Built exactly that way.**

- There is **no override column and no reason column** on the invoice line table.
  A screen cannot offer amber-and-continue, because there is nowhere to save it
- Different rate → the line **splits by quantity and rate**, and each differing
  piece must point at a **PO amendment**
- The amendment shows the rupee difference, worked out by the database
- **The bill cannot be approved until the owner approves the amendment.** A
  trigger (an action the database takes by itself) refuses it
- Why: a phone call is not a record. The PO revision is — dated, approved, sent,
  held by both sides

Proven end to end, in a transaction that was rolled back:

| Step | Result |
|---|---|
| Bill 250 at the PO rate of 64 | accepted |
| Bill 250 at 66.50 with no amendment | **blocked** |
| Same line with an amendment attached | accepted |
| Approve the bill while the amendment is unapproved | **blocked** |
| Approve the amendment, then the bill | accepted |
| Difference calculated by the database | ₹625 |

---

## The tables

**Approval engine — its own tables, liftable later**
- `approval_rules` — the 6 rules, seeded. Each points at a **role**, never a name
- `approval_delegations` — person, limit, date range. Ends by itself
- `po_approvals` — which rules fired on a PO, **with the rule copied in as it was
  at the time**, so an in-flight PO keeps the rule it was raised under

**Requests and quotations**
- `purchase_requests` + `purchase_request_lines`
- `quotations` + `quotation_lines`

**Purchase orders**
- `purchase_orders` + `purchase_order_lines`
- `standard_terms` (the 17, seeded) · `po_terms` (this PO's editable copy) ·
  `vendor_default_terms` (remembered per vendor)
- `annexure_templates` · `po_annexures`
- `po_followups` · `po_amendments` · `po_dispatches`

**Receiving, bills, returns**
- `goods_receipts` + `goods_receipt_lines`
- `purchase_invoices` + `purchase_invoice_lines`
- `purchase_returns` + `purchase_return_lines`
- `short_closes`

**Money**
- `vendor_payments` + `vendor_payment_allocations`
- `vendor_advances` + `vendor_advance_adjustments`

**Laser**
- `laser_drawings_sent`

---

## Rules the database now enforces by itself

Each of these was tested. All 16 behaved correctly.

- A PO to a party who is **not a registered vendor** is refused
- A PO to a **blacklisted** vendor is refused
- A **provisional PO cannot receive material** — no challan, no invoice
- A challan taking a line **over the item's acceptable %** is refused unless the
  owner accepts it. Laser lines marked "estimated" are exempt, as agreed
- A follow-up **cannot be pushed later**, only pulled earlier
- A follow-up **dated after the promised delivery date** is refused
- The **chase the day before delivery cannot be deleted.** It moves with the date
- An **advance adjusts only on the PO it was paid against**
- A **drawing cannot be sent without a file** — the column simply cannot be empty
- **Whoever raises a PO cannot approve it**
- The **backdated-PO rule cannot be switched off** — a constraint makes it impossible
- **Duplicate bill check is vendor + invoice number + financial year**, and the
  financial year is worked out from the invoice date, never typed
- A bill **dated before its PO**, or in the future, is refused
- **Taxable + tax must equal the total**, or the bill will not save
- **CGST/SGST and IGST can never both be present**

---

## Nothing is stored that should be counted

Convention 6, strictly. There is **no column anywhere** to type these into:

- `po_line_progress` — ordered, received, returned, billed, short-closed per line
- `purchase_invoice_pending` — bill total less payments, advances and debit notes,
  plus the **one signed number** for the due list (+3 overdue, 0 today, −7 to go)
- `vendor_advance_balances` — advance less adjustments
- `received_not_billed` — material in the plant with no bill, and how many days

---

## Three decisions I made

- **`po_approvals` added** (not on your list). Needed because "in-flight POs keep
  the rule as it was when raised" has to store the rule somewhere, and because
  approval logic was to stay in its own table
- **`po_dispatches` added** (not on your list). Doc 09 says every outgoing email
  is stored against the PO and a bounce is flagged on the vendor. Nowhere else to
  put it
- **Terms split into three tables** instead of one. The 17-term library, the
  editable copy on each PO, and the per-vendor memory are three different things.
  One table doing all three would be clever and unreadable

**Roles map onto permissions**, since the ERP has no separate role list:
purchaser = holds `purchase_order.create` · purchase manager = holds
`purchase_order.approve` · owner = `is_owner()`.

---

## One small gap, stated plainly

- The chase the day before delivery **can still be moved later by hand**, because
  it has to be free to follow the delivery date when that moves
- Every other follow-up is locked to pull-earlier-only
- It is system-maintained, so this is unlikely to matter. Say the word if you want
  it locked to system changes only

---

## Still waiting on your answer, from Phase C

- **Partnership firms cannot be registered.** PAN 4th letter is F for a
  partnership, and the locked rule only allows C and P. Say "add F" and it is done
- **The old `uom` column on items** — say drop it and it goes

---

## Not built, on purpose

- **Vendor scorecard.** It is entirely derived from POs. Better built once real
  POs exist, so the numbers can be checked against something
- **Follow-up bands in Settings.** Doc 09 lists the 3/10/15-day seed as still
  open, so seeding a guess would only have to be undone
- Screens. This phase was schema only
