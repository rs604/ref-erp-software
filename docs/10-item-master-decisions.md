# Item Master — decisions locked

**Locked:** 9–10 Sep 2026. Ready to build.

**Companion files:** `REF_Item_Master_FINAL.xlsx` (the data) ·
`Item_Master_Build_Checklist.xlsx` (49 tests)

---

## What the existing sheet actually contained

- 4,173 purchase items + 1,544 sales items
- **2,872 purchase items are steel — and it is a generated grid.** Exactly 569
  items in each of SS 202, 304, 310, 316. MS is 570
- **Zero opening stock on any row.** None of it came from real purchases
- **304 items appear in sales but never in purchase.** Those are the things
  Raghbir makes. Nothing labelled them
- **No GST rate on any row.** The column is empty on all 4,173

---

## The finding that changes how duplicates must work

- **Name similarity matching does not work on this data. It produced 801 false
  positives**
- `SS 310G Flat 50 x 5` and `SS 316G Flat 50 x 5` are 97% similar and are
  different steel
- `UCF 207` and `UCFL 207` are different bearings, one letter apart

**The rule**

- Numbers and codes must match **exactly** before anything is flagged
- Different number = different item = no warning, no block
- Fuzzy matching survives only for spacing, case, punctuation and genuine typos
- **Structured groups compare FIELDS, not names**

---

## The four axes — never collapsed

| Axis | Question | Values |
|---|---|---|
| **Item type** | What happens to this thing? | Raw Material · Component · Semi-Finished · Finished Goods · Consumable · Asset · Service |
| **Group** | Would the form ask the same questions? | Steel Sections, Bearings, Electricals… |
| **Source** | How did it come to exist? | Bought out · Made in-house · Job work |
| **Can be sold** | Yes / No | |

### Deciding the item type

- Becomes part of what I sell, bought whole → **Component**
- Becomes part of what I sell, I make it → **Semi-Finished**
- Becomes part of what I sell, after cutting or shaping → **Raw Material**
- The machine actually invoiced → **Finished Goods**
- Used up doing the work → **Consumable**
- Kept and used for years → **Asset**
- Nothing physical arrives → **Service**

### The governing rule

> **The thing never changes. What you do with it changes.**

- A bearing is a bearing whether fitted or sold
- Selling something never promotes it to a different type
- Which machine it goes into never changes what it is

### The two arguments the team will have

- **"Is it an asset?"** — will it still be working in a year **and** did it cost
  over ₹1,000? Both, or it is not
  - Antivirus expires yearly → Service, not Asset
- **"Which group?"** — would the form ask the same questions? No → different group
  - **Never group by which machine it goes into**

### Leaves the gate and comes back changed → new item

- **The test:** would you mind which one you got? A plain slat and a coated slat
  are not interchangeable, cost different amounts, and material at the coater must
  be visible
- Comes back **the same**, only from elsewhere → same item, different location
- **Liquid painting is done in-house and creates no new item.** Powder coating
  goes out and creates one
- **Applies only to parts made repeatedly.** One-off project parts never enter the
  master

---

## The form

### Mandatory (11)

Group · Sub-group · Item name · Unit · Item type · Source · HSN · GST % ·
Category · Can be sold directly · Quantity above and below acceptable %

### Optional (6)

Sales name · Made for · Min selling price · Max order qty · Files · Remarks

### System-filled, never typed

Item code · status · created by/on · approved by/on · last purchase rate, vendor
and date · best rate ever · total purchased · current stock · vendor count

### Field rules

- **Item code** — plain running number from 5000000. No prefix, no meaning.
  The old `REF50001AST` codes are removed; they were never used anywhere
- **HSN and GST mandatory.** GST is suggested from the HSN, correctable once, and
  the correction is remembered
- **HSN minimum digits is a setting** — 4, 6 or 8. Default 4, which is correct
  below ₹5 crore turnover
- **A short HSN shows in red everywhere** and **blocks the PO**, so items actually
  used get fixed first. No cleanup project
- **Fixed from the PO with F4**, which opens the item master and returns with the
  code updated. **HSN correction needs no approval** — it is a factual code.
  A GST rate change from it **does**, because a wrong rate repeats on every bill
- **Never say "error"** — say *"HSN 8414 has 4 digits. Your setting requires 6"*
- **Unit** — one per item. Changing it needs a request and approval
- **Sales name** — bought-out and trading items only, to stop a customer
  price-matching online. **Blank for anything made in-house** — nobody can google
  a head pulley you fabricated. Blank is normal, not an error
- **Made for** — appears **only** for made-in-house or job-work items. **One
  machine, not several.** Auto-filled from names like `For 4WOHC`
- **Min selling price** — optional. Last purchase rate shows beside it while
  typing. Below it: **warning only, never a block**. The sale continues and comes
  to the owner with a mandatory reason. Effective-from dated, never overwritten
- **No purchase price field.** It changes every purchase. Last purchase rate is
  derived from actual POs
- **Max order qty** — blank at start. No history exists, so any number now is a
  guess
- **Quantity above / below acceptable %** — mandatory, zero is a valid answer that
  must be typed. Default from the group, overridable per item
- **Why mandatory:** blank is ambiguous. Nobody knows later whether it meant zero
  or nobody thought about it

### Name entry

- **Typing, not structured forms.** Structured forms need field lists built per
  group first — weeks of setup before a single item can be added
- **Fuzzy + regex checking on top**, with the exact-numbers rule above
- **A name pattern per sub-group**, shown above the box as a reminder of the order
  - Electricals → MCB: `Item · Ampere · Poles · Make` → `MCB 63 Amp DP Siemens Make`
  - Electricals → Contactor: `Item · Ampere · Make`
  - Electricals → Relay: `Item · Pins · Size · Make`
- **Why sub-group, not group:** Electricals is too broad. An MCB has poles, a
  relay has pins
- Out-of-order typing warns, does not block
- Define patterns for 5–6 big groups only. Everything else free-typed
- **Upgradeable later** to real dropdowns per sub-group without redoing anything

### Automatic cleaning — runs BEFORE the duplicate check

- Multiple spaces → single space; leading and trailing spaces removed
- Curly quotes `”` → straight `"`; `½` → `1/2`
- Spacing normalised around `x` in sizes
- **Why before:** cleaning afterwards compares dirty text and misses the match

### Rules button

- On the create screen **and** the approve screen
- Plain language, editable by the owner only
- The approver sees the same pattern the creator saw, with the name broken into
  parts so an out-of-order name is visible

---

## Groups, sub-groups and categories

- **Group** decides which questions the form asks
- **Sub-group** carries the name pattern and the field set
- **Category** decides which report the money lands in
- They are different things and must never be merged

### Categories (10)

| Category | Contains | ~Items |
|---|---|---|
| Steel & Metals | steel sections, aluminium, sheets, castings | 2,880 |
| Transmission | bearings, gear boxes, pulleys, belts, chains, brakes | 880 |
| Electricals | MCB, cable, VFD, motors, panels, pneumatics | 145 |
| Hardware & Fasteners | bolts, nuts, clamps, wire rope, rigging | 70 |
| Machine Parts | wheels, shafts, brackets, covers, frames | 160 |
| Tools | hand tools, power tools, bits, sockets, machinery | 90 |
| Consumables | paint, welding, oils, chemicals, safety | 55 |
| Job Work | laser cutting, powder coating, fabrication charges | grows |
| Overheads | labour, rent, legal, repairs, software | 25 |
| Office & IT | computers, fans, furniture, stationery, printing | 20 |

- **Capital:** Office & IT, plus machinery inside Tools. Everything else Revenue
- Default view is total cash out; one toggle separates. The purchase team never
  sees the tag
- **Freight, packing and loading are not categories** — they are charge lines on
  the PO with their own bucket
- A group may appear under more than one item type. Electricals holds bought
  components and panels assembled in-house. That is correct — the axes are
  separate on purpose

### Groups dissolved and why

- **Machine-name groups** — Conveyor Components, Lift Components, Crane
  Components, Crane Parts. A gear box is a gear box. Which machine it feeds is a
  job question
- **Trading Items** — not a type. Each item moved to its real group with
  can be sold = Yes
- **Marketing + Stationary** — 6 items between them, merged into Office & IT
- **Miscellaneous** — duplicate of Others
- **Freight Charges** — removed as an item

---

## Finished Goods

- **The machine type is the item. The size is not.** A 100 ft and a 60 ft belt
  conveyor are the same item; length, width and load are specs on the invoice line
- **Why:** otherwise every custom size creates a new item and the master dies
  within a year
- **Variants are separate items** where they are genuinely different products

### The 18

Belt Conveyor — Flat · Inclined · Cleated
Slat Conveyor — Horizontal · Inclined
Overhead Conveyor — 3 Wheel · 4 Wheel · I-Beam
Roller Conveyor — Gravity · Powered · Wire Mesh Conveyor
Lift — Counterweight · Drum Weight · Hoist · Crane (UT) · Chain Block · Trolley ·
FIFO Rack

### What a machine consumed

- Answered by the **job**, not by a BOM. The work is custom; no fixed recipe
  exists
- Job cost = actual issues to that job. Compared against the Google Sheet
  estimate, this shows leakage
- One line on the customer invoice; full part breakdown behind it
- **Project-specific parts never enter the master.** They belong to the job. If
  the same part appears on a fourth job, the system suggests promoting it

---

## Machine-wise reporting

**The requirement:** how many of each machine sold, and how much spares revenue
per machine type, to decide focus and stocking.

- **"Made for" sits on the item, not on the sales invoice.** Nothing to click
  daily, nothing to get wrong
- Filled **only** on items made in-house or job-worked — those are made for one
  specific machine
- **Bought-out common parts are deliberately untagged.** A bearing fits conveyors,
  lifts and hoists; any tag on it would be false
- Transmission parts — sprockets, pulleys, V-belts — also stay untagged
- **Accepted explicitly: this answers ~80–90%. 100% is not achievable**

**Rejected:** a machine dropdown on every sales invoice line. Mandatory fields
invite careless clicking, and the data would be unreliable in exactly the places
it matters.

---

## Duplicates found in the existing sheets

- **Only 9 genuine duplicates in 4,490 items.** The master is cleaner than
  expected
- Sockets entered twice under two sub-categories (`Socket 1/2" x 15` vs
  `Socket 1/2" X 15`)
- `Screw Drriver Adapter` — typo
- `Tool Tray For SKD Conveyor` — entered twice

### Corrections Raghbir found in Claude's own mapping

Worth remembering as a pattern:

- **Antivirus K7, Busy Software, Barcode Software** were mapped as **Assets**
  because their old sub-category was "Office Equipments". They are Services
- **Cat 6 Cable** was in Office Equipment. It is Electricals
- `Conveyor Shaft For Wire Mesh Conveyor` went to Electricals because a keyword
  rule matched the word "wire"

**Lesson: bulk mapping by old sub-category works for volume, but every group has
strays inside it. Small counts in a group are where the errors cluster.**

---

## Still open

- **GST rate per HSN code.** The sheet has none. Slabs are 0, 5, 18, 40 — the 12%
  and 28% slabs were abolished on 22 Sep 2025. Fill by HSN, not item by item
- **324 items have no HSN.** Mandatory, so these block go-live
- **305 made-in-house items** need confirmation
- **139 made items have no "Made for"** — the name did not say which machine
- **160 items** in Others / Machine Parts / Office Equipment / Machinery / Hand &
  Power Tools need review
- **The 18 finished goods** need confirming
- **Item groups and sub-groups** need defining
- **Minimum selling prices** — none set. Start with items on real invoices
