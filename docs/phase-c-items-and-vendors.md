# Phase C — items and vendors extended

**Date:** 12 Sep 2026 · **Status:** done, applied to Mumbai, pushed
**Built from:** doc 09 (purchase & vendor), doc 10 (item master), doc 11 (UI), doc 12 (architecture)

---

## Before anything else — the repo and the database had drifted apart

- The README says *"Replay `migrations/` in filename order. There is no other
  source of truth."* **That was not true when this phase started**
- **Three migrations (changes to the database) had been applied to Mumbai but
  existed nowhere in GitHub.** Their SQL lived only inside Supabase
- This is the exact mistake doc 12 says must never be repeated — the 14 Tokyo
  functions that existed only inside Supabase, with no repo copy

### What was missing

| Migration | What it did | Was in GitHub? |
|---|---|---|
| `18_gstin_on_branch_and_aadhaar_last4` | Moved GSTIN to the branch; cut Aadhaar to last 4 digits | **No** |
| `19_create_owner_account` | Created Raghbir's party, roles and login | **No** |
| `20_restore_employee_fields_the_screen_uses` | Put back 18 employee fields the screen asks for | **No** |

- **All three are now recovered into `supabase/migrations/` and pushed**
- Recovered from Supabase's own record, then **checked by fingerprint (md5)
  against what actually ran.** All three match exactly — not retyped from memory
- `19_create_owner_account` was read first to be sure it held no password. It
  does not — the password is made at random inside the database and thrown away
- One file went the other way: `18_create_login_for_party` is in GitHub but was
  never recorded as a migration. The function it creates **does** exist in
  Mumbai with the exact same shape, so nothing is missing — only the bookkeeping
  entry. Left alone rather than fiddled with

**Replaying the migrations folder now reproduces the live database.** It did not
before.

---

## What was added — items

Seven axes from doc 10 now exist as real columns and tables, kept apart on purpose.

### New tables (6)

| Table | Why it exists |
|---|---|
| `units` | Masters > Units in the nav. So "Kg" is spelled one way everywhere |
| `item_categories` | The 10 categories. Decides which report the money lands in |
| `item_groups` | Decides which questions the form asks. Carries the default tolerances |
| `item_sub_groups` | Carries the name pattern. Electricals is too broad for one pattern |
| `hsn_codes` | GST suggested from HSN, corrected once, correction remembered here |
| `item_selling_prices` | Minimum selling price, dated, never overwritten |

- All 10 categories seeded, with Office & IT marked capital
- 15 units seeded
- Machinery inside Tools is capital while the rest of Tools is not, so an item
  can override its category with `spend_type_override`

### Added to the existing `items` table

- `unit_id` · `group_id` · `sub_group_id` · `source` · `can_be_sold`
- `sales_name` · `made_for_item_id` · `max_order_qty`
- `qty_above_acceptable_pct` · `qty_below_acceptable_pct`
- `spend_type_override` · `remarks` · `approved_by` · `approved_on`

### Three item rules the database now enforces by itself

- **A sales name is only allowed on a bought-out item.** Nobody can google a
  head pulley you fabricated, so the field is refused on made-in-house items
- **"Made for" is only allowed on made-in-house or job-work items.** A bearing
  fits conveyors, lifts and hoists — any machine tag on a bought-out part is false
- **The seven item types are the only ones accepted.** The old list had `part`,
  `finished_good` and a catch-all `material` **as the default**, which would have
  let every item be created without anyone deciding what it is. That default is gone

---

## What was added — vendors

### Added to `vendor_details`

- `business_types` (multi-select: manufacturer / trader / service / exporter)
- `deals_in` — free typing from the visiting card
- `needs_update` + `needs_update_reason` + `needs_update_since` — the one general flag
- `blacklisted_by` · `unblacklisted_on` · `details_checked_on`

### Added to `party_addresses` (a branch is an address)

- `map_location` · `latitude` · `longitude` — a Maps link, or a dropped pin.
  A pin always works for a unit with no Google listing

### New table (1)

- `party_group_links` — two separate vendors that are one group under different
  GST numbers. **This is the point of the group link:** you see what each unit of
  the same group quoted for the same item. Same people, different price

### Six vendor rules the database now enforces by itself

- **PAN must match what the party is** — 4th letter C for a company, P for a person.
  Catches a personal PAN typed onto a company record
- **A GSTIN must carry its owner's PAN** — characters 3 to 12 of a GST number are
  always the PAN. Catches a mistyped GSTIN with no internet lookup at all
- **Duplicate mobile or landline is blocked, and the block names the holder** —
  *"Mobile 9812345670 already belongs to Sharma Steel. Link that record instead of
  entering it again"*
- **The same contact mobile at two firms is blocked the same way.** A salesman at
  two firms gets linked, never retyped
- **A bank account cannot belong to two parties.** Paying the wrong firm because a
  number was reused is the expensive version of this mistake
- **MSME ticked with no Udyam number is refused on submit.** MSME shortens the
  legal payment deadline to 45 days, so an unverifiable claim must not be accepted.
  Drafts are still allowed to be incomplete

---

## Numbers changed to match doc 11

| Thing | Was | Now | Why |
|---|---|---|---|
| Item code | `ITM-00001` | `5000000`, then 5000001… | No prefix, no meaning. Item codes never leave the building |
| Vendor code | `VEN-0001` | `V-0001` | Doc 11 locks `V-0042`. Appears on printed documents |

- The numbering function was extended to allow an empty prefix, so a bare running
  number has no leading dash. Nothing else about it changed

---

## Proof it works

Nine rules were tested against the real database inside one transaction that was
then **rolled back**, so no test data was left behind.

| # | Test | Result |
|---|---|---|
| 1 | Company with a P-type PAN | blocked |
| 2 | Company with a C-type PAN | accepted |
| 3 | Same mobile on a second party | blocked, named the holder |
| 4 | Retired item type `material` | blocked |
| 5 | New item type `component` | accepted |
| 6 | Sales name on a made-in-house item | blocked |
| 7 | "Made for" on a bought-out item | blocked |
| 8 | MSME ticked, no Udyam number | blocked |
| 9 | First item number / first vendor number | `5000000` / `V-0001` |

- Checked afterwards: item numbering still starts at 5000000, still 3 parties,
  still 0 items. The rollback was clean

---

## Nothing was rebuilt, nothing was dropped

| | Before | After |
|---|---|---|
| Tables | 45 | **52** (7 new) |
| Security policies | 111 | **134** (23 new) |
| Permissions | 31 | **35** (4 new item ones) |

- **All 111 original policies are still there.** The new item permissions were
  ADDED alongside the old owner-only rule rather than replacing it, because
  Postgres treats several rules as "any one of these may allow it"
- Every new table has the standard five columns, row-level security switched on,
  three real policies, and the standard triggers. Checked, not assumed
- **No table and no column was dropped.** One check constraint on `items` was
  replaced, because the old one allowed the retired item types

### Security check after the change

- Supabase's own security scan was run. **Nothing new was flagged**
- The five items it does flag were all there before this phase and are all
  deliberate — `job_secrets` is meant to be readable by nobody, and the
  `next_human_number` grant was made on purpose in migration 13

---

## Two things that need your one-line answer

**1. PAN fourth letter — partnership firms will be blocked**

- Doc 09 says: 4th letter C for a company, P for an individual. Built exactly that way
- **But a partnership firm's PAN has F as the 4th letter**, and Ludhiana has a lot
  of them. A trust is T, an HUF is H
- As built, a partnership-firm vendor **cannot be registered**
- Say the word and I add F, and any others you want

**2. The old `uom` column on items**

- `unit_id` replaces it and points at the new units list
- `uom` is still sitting there, marked "do not write to it", because dropping a
  column needs your approval
- Say drop it and it goes

---

## Deferred to Phase D, on purpose

These are all purchase-module things and belong with the purchase tables:

- Last purchase rate, best rate ever, total purchased, vendor count on an item —
  **these are never stored.** They are added up from the POs, which do not exist yet
- Vendor scorecard — same reason. Derived from POs, minimum 3 POs before ranking
- The 17 PO terms remembered per vendor
- Free stock, which drives automatic purchase requests

## Still open from doc 10 — data, not structure

- GST rate per HSN code. The sheet has none. The `hsn_codes` table is built and empty
- 324 items with no HSN, 305 made-in-house items to confirm, 139 with no "Made for"
- Item groups and sub-groups need defining. The tables are built and empty
- The 18 finished goods need confirming
