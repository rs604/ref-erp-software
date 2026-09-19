# Purchase & Vendor — decisions locked

**Locked:** 9–10 Sep 2026. Ready to build.

**How to read this:** every rule says what it is and why. A rule without its
reason gets changed back in a year.

---

## Company header

- **Raghbir Erectors & Fabricators** — proprietorship, Ludhiana, Punjab
- xxix, 310-B, St. No. 21, GRD Nagar, Makkar Colony, Sua Road, Inds. Area-C,
  Dhandari Kalan, Ludhiana, Punjab - 141010
- GST **03ADVPS6303E1ZI** · Jurisdiction Ludhiana · Phone 6283363824
- **"Ref Conveyors" is dropped entirely.** One firm, one GST, one number series

### The second firm — RS Industries

Taken from an RS tax invoice, 19 Sep 2026. Two firms, two GST numbers, and
**neither number ever appears on the other firm's paper** — `busy.test.js`
refuses it.

- **RS Industries** — proprietorship, Ludhiana, Punjab
- #304F, Sua Road, Industrial Area-C, Dhandari Kalan, Ludhiana - 141014
- GST **03CCTPS7440B1ZI** · Phone 99154-58452 · rsindustries.ldh@gmail.com
- PAN **CCTPS7440B** — **derived, not copied.** The invoice left its PAN field
  blank. It did not need to be filled: the PAN is the middle ten characters of
  the GSTIN by construction, and that rule reproduces REF's own known PAN from
  REF's own GSTIN exactly. The fourth letter, P, agrees with a proprietorship.
  Correct it here if it is ever shown to be wrong.

### Email

- Sends **from** `accounts@refconveyors.net` — the only DNS-verified domain
- **Reply-To** `accounts@refconveyors.com` — the real inbox
- CC the buyer who raised the PO
- PDF header shows the `.com` address, which is what vendors know
- No mailbox needs creating on `.net`. Resend sends from a verified domain
- **Why not just use .com:** Raghbir has no registrar access. A reseller controls
  it and Workspace must not be disturbed

---

## Vendor master

- **The old tables were good work.** Migrate the structure, fix during migration.
  Do not rebuild
- **All legacy rows are fake.** Structure migrates, data does not. The list starts
  empty
- **Why empty:** every real vendor then enters through the new rules — GST
  certificate, cancelled cheque, no duplicate numbers

### Form order — matches a phone call

1. **Company / Individual** — first choice, reshapes the whole form
2. **COMPANY** — name · GSTIN + upload · state (auto) · PAN + upload · business
   type · credit days · deals in · MSME tick → Udyam number + upload
3. **ADDRESS** — address · city (dropdown) · PIN · map location
4. **COMPANY PHONE & EMAIL** — optional, a list of rows
5. **CONTACT PERSONS** — at least one mandatory
6. **BANK** — IFSC first, bank name pre-fills
7. **OTHER DOCUMENTS** — type a label, then upload

### Field rules

- **Company name** — must match the GST certificate exactly, or input tax credit
  can be rejected
- **GSTIN** — first two digits set the state. Never typed
- **PAN** — 5 letters, 4 digits, 1 letter. **Fourth letter must be C for a
  company, P for an individual.** Catches a personal PAN on a company record
- **GSTIN characters 3–12 must equal the PAN.** Catches a mistyped GSTIN with no
  external lookup
- **Business type** — multi-select: manufacturer, trader, service, exporter
- **Deals in** — free typing from the visiting card, comma separated, multi-line.
  **Why not a list:** ticked item groups are too much maintenance
- **City** — dropdown, not typed. **Why:** typing produces five spellings of
  Ludhiana
- **Map location** — Maps link or a dropped pin. A pin always works for a unit
  with no Google listing. **Mandatory is a setting**, off by default
- **Contact persons** — name, department, mobile mandatory. Department and
  designation are dropdowns from Settings
- **Bank** — IFSC first, bank name pre-fills but **stays editable**
- **Why editable:** when banks merge the codes change. A record from 2024 must
  keep the bank name it had then
- **Settings button refreshes the bank list** from the Razorpay open IFSC dataset
  on GitHub. After a refresh, every vendor whose IFSC no longer resolves is
  flagged and payments to them blocked

### Validation

- **Mobile** — 10 digits, starts 6/7/8/9. Spaces and +91 stripped
- **Email** — proper format, warns on gmial, gmail.co, yahho
- **IFSC** — 11 characters, fifth is zero
- **PIN** — 6 digits, should match the city
- **MSME = Udyam.** One number, one certificate. Registration became Udyam on
  1 July 2020 and the old Udyog Aadhaar numbers stopped being valid
- **Udyam mandatory only when MSME is ticked.** It shortens the legal payment
  deadline to 45 days, so an unverifiable claim must not be accepted

### Deleting while creating

- **Bin icon on every row** while the vendor is a draft. Delete freely
- **Once registered:** contacts are ended not deleted, bank accounts deactivated
  with a reason, documents replaced not removed
- **Genuine mistake on a registered vendor** — "remove, added by mistake", reason
  required, owner only. Stays in change history
- **Why the difference:** a bank account that received ₹4 lakh must never
  disappear. One typed wrong five minutes ago and never used is just noise

### Individual contractors

- **No GSTIN.** PAN mandatory, Aadhaar optional
- **Only the last four digits of Aadhaar are stored.** Nothing to mask, nothing
  to leak. PAN carries the TDS weight
- **Photo mandatory** — a face is often the only reliable identifier
- **Bank optional.** Empty means paid in cash
- Business type not asked — a service provider by definition
- **"His people"** replaces contact persons: the contractor, any supervisor left
  at the plant, any worker you call. Role is free text, not mandatory
- **GST shows "Nil — unregistered"**, greyed, so nobody wonders

### Branches

- **The word "branch" never appears on the first screen.** 90% have one place
- Two dashed lines at the bottom, both optional:
  - *"another unit or godown with the same GST number"* → a unit inside this
    vendor
  - *"part of a group with a different GST number"* → links a separate vendor
- **GSTIN belongs to the branch.** A vendor with units in two states has two
- **Unique per vendor company, not per branch.** The same GSTIN may repeat across
  that vendor's branches; held by a different party it is blocked and the holder
  named
- **The group link is the point** — you see what each unit of the same group
  quoted for the same item. Same people, different price
- PO dropdown shows branches: `Sharma Steel — Unit 2 — Ludhiana — Steel`
- A new branch on a registered vendor needs Raghbir's approval

### Blocked with no override

- Duplicate GSTIN, mobile, landline, reception number, bank account
- The block **names the holder**
- A salesman at two firms is **linked**, never retyped
- A transferred number must first be ended on the old vendor — owner only, stays
  in history
- A landline range reserves the whole block

### Blacklisting

- **`status` is approval life only:** draft · pending_approval · approved ·
  rejected
- **`is_blacklisted` is the only home for the ban**, plus reason, who, when
- A vendor is `approved` AND `blacklisted` at the same time
- **Why separate:** the old design stored it in both places. Writing
  "blacklisted" into status erased "approved"
- Vendor is **absent** from the PO dropdown, not greyed. Search still finds him,
  in red, with the reason
- Open POs are **not** cancelled: *"3 open POs, ₹4.2 lakh pending. Blacklist
  anyway?"*
- **Un-blacklisting returns him to `approved` automatically**, marked "details not
  checked since [date]"

### "Update needed" — one general flag

- One chip on the list, count shown, reason on the row
- Reasons so far: IFSC no longer valid · details not checked since a date · no
  activity for a long time · document expired
- **Why one flag:** new reasons get added later with no redesign
- What it blocks depends on the reason. A dead IFSC blocks payment. A stale record
  only asks for confirmation on the next PO

### GST rule

- **Company** → GSTIN mandatory. No GSTIN, no registration, no PO
- **Individual** → PAN mandatory, no GSTIN, GST as zero on every PO
- GST appearing on an unregistered vendor's bill is **blocked** at invoice entry
- **Reverse charge: rejected entirely by Raghbir.** Explained twice. His position
  is that the ERP is for records, not returns. Stated once for the record that it
  remains a legal obligation and his accountant's job

### Vendor list protection

- **10 most recently added by default.** Search reaches all
- **Why:** one screenshot should never capture the whole supplier list
- Counts shown honestly — hiding them protects nothing
- **Drafts and pending always fully visible**, with who created them, or people
  re-enter them
- Every search and record opened is **logged quietly**. No banner
- Unusual volume in a day notifies the owner. Threshold in settings
- Export and print logged separately, at a much lower threshold

---

## Purchase requests

- **Anyone can raise one. No approval to ask.** Asking costs nothing; buying is
  what needs approval
- Six fields: what you need · how many · needed by · required for · urgency
- **Item search first, free text as a deliberate last choice** — "not in the list,
  send my words instead"
- Free-text lines show amber to the purchaser with "pick the item"
- **Close to an existing item** → the raiser is asked once, "did you mean...?"
- The match is remembered, so free text almost disappears over months

### Urgency — response time, not delivery time

- **Breakdown** — machine stopped. Purchase starts within 4 hours. **Pings the
  manager's phone.** Also pings the owner if nobody acts within an hour
- **Urgent** — purchase acts the same day
- **Normal** — the needed-by date governs
- **Why:** urgency measures how fast purchase acts. When material arrives is the
  vendor's constraint and cannot be fairly measured
- Track how often each person marks Breakdown. If everything is a breakdown,
  nothing is

### Three sources, one document

- **Manual** · **Project** (a confirmed project's material list) · **Automatic**
  (free stock hits minimum)
- **Free stock, not physical stock.** 120 bearings with 100 locked to a job means
  20 free. Most systems get this wrong
- **Never re-raise.** An open request updates its quantity instead
- **Merge duplicates** — three projects needing the same bearing is one PO

### The queue

- Breakdown first, then by deadline
- **Every row has a deadline to issue the PO**, from the item, not a global setting
- **Free stock on every row** — half these may be satisfiable from the shelf
- **The purchase manager cannot reject.** Only the raiser (cancel own) or the
  owner. The manager raises a rejection request. The raiser is always told why

---

## Purchase orders

- Status: draft → submitted → approved → completed, plus cancelled
- Tracking level chosen at creation: whole PO, or line by line
- **First follow-up date mandatory**
- **Registered vendors only.** Verbal deals happen off-system
- Email from **the creator**, CC approver, so replies reach the buyer
- No email on the vendor → marked "hard copy", printed, print recorded

### Approval by exception — 6 rules

1. Rate higher than the last purchase rate
2. A new vendor's first PO
3. PO value above the limit for that role
4. Item never purchased before
5. **Backdated PO — always on, cannot be switched off, owner only**
6. Quantity above the item's maximum

- **Limits per role:** purchaser ₹10,000, manager ₹50,000, above that the owner
- **Whoever raises a PO cannot approve it**
- Rules point at a **role, never a person's name**
- In-flight POs keep the rule as it was when raised

### Delegated approval

- Name a person, set a limit, set a date range
- Recorded under their own name with "delegated by Raghbir"
- **Ends automatically.** No forgotten permanent access
- The delegate cannot approve his own PO

### Provisional copy

- For the genuine short gap, not a two-week absence
- Watermarked **PROVISIONAL — NOT A PURCHASE ORDER**
- Records who authorised verbally and how
- **Cannot receive material.** No challan, no invoice until approved
- Listed for the owner on return. The real PO supersedes it automatically

### Follow-up engine

- Bands in Settings: delivery within X days → chase on these days
- All dates created at PO creation. **Can pull earlier, never push later**
- **Always one automatic chase the day before promised delivery.** Cannot be
  removed, moves with the date
- A follow-up dated after the delivery date is blocked
- Delivery slip → schedule rebuilt, never fewer chases. **3 slips → owner notified**
- Every follow-up records which contact, mode, what was said
- **"No answer" is recorded but does not count as a follow-up.** Three in a row is
  a signal

### Field rules

- **PO number** — system generated, not editable
- **PO date** — today by default. Earlier needs a reason and always owner
  approval, marked "Backdated" everywhere including the PDF. Future blocked
- **Promised delivery** — mandatory, today or later, soft warning beyond 180 days
- **Reference** — mandatory, free text, type-ahead on prior entries
- **Rate** — last rate, vendor, date and best-ever shown under every line
- **>3× or <⅓ the last rate** → loud warning, **no block**. 3× configurable
- **GST rate and unit** — from the item master, read-only
- **Freight, packing, loading** — separate footer lines, own GST, own spend
  category. **Never inside the item rate**
- **Line amount, round-off, total** — calculated, never typed

### Three text areas, never confused

- **Remarks** — prints on the PO face
- **Technical annexure** — prints as Annexure A, revision-tracked, saveable as a
  template per group
- **Internal note** — never printed, never emailed
- **Attachments individually marked** — send to vendor, or internal only

### Terms — 17, editable per PO

Freight · loading/unloading · insurance-transit · packing & forwarding · payment
terms · GST · price validity · delivery schedule · delivery location · late
delivery · material test certificate · inspection before dispatch · rejection
(lift back at vendor cost in 7 days) · warranty 12 months · PO number on
documents · jurisdiction (Ludhiana) · unauthorised supply

- **Remembered per vendor.** Steel vendors always get the mill certificate term
- Dropped: "documents required with material", "invoice in the name of"

### Dispatch

- PDF auto-emailed on approval, or on creation where no approval is needed
- Status: sent · delivered · opened · **bounced**. Bounced flagged on the vendor
- Revisions marked "Revision 1", vendor auto-sent the revised copy with the
  changes stated. Both kept
- Every outgoing email stored against the PO

---

## Quotation comparison

- **Max 4 vendors.** Items down, vendors across
- Every cell shows quoted rate **and landed cost**. A cheaper rate with freight
  can lose
- **Delivery days beside every rate.** Cheapest but too late is excluded
- **Blank means not quoted.** Never zero
- Scorecard in every column header
- **Unregistered vendors may quote.** Registration blocks POs, not enquiries
- **Recommendation is per item**, on landed cost within the required-by date.
  Split orders are normal
- Override allowed with a mandatory reason → always the owner
- Approving creates all the POs automatically
- **Losing quotes are kept** — price history for items never bought

---

## Receiving material

### Challan first, invoice later — two steps

- **Challan:** number, date, quantity per line. No photo needed
- PO receipt state updates. **Nothing enters the payment list yet**
- **"Received but not billed" list** — material in your plant with no bill. Money
  you owe but cannot see. Anything over 30 days is worth chasing
- **Invoice later:** pick the vendor, open challans appear, tick which this bill
  covers

### Quantity tolerance

- **Quantity above acceptable %** and **Quantity below acceptable %**
- Mandatory on every item. Zero is a valid answer and must be typed
- Default from the group; the item can override
- **Why:** steel is cut to standard lengths. 5,000 Kg can arrive as 4,900 or
  5,100. Bearings have zero tolerance
- Outside tolerance → blocked, needs owner approval
- Under tolerance → the line stays open, follow-up continues

### Rate — the rule that changed late

- **Bill rate must EQUAL the PO rate.** No override, no reason box
- **When the vendor bills differently**, the invoice line **splits by quantity and
  rate** — 250 @ ₹64 and 250 @ ₹66.50
- Saving generates a **PO amendment** for the owner, showing the rupee difference
- Approved → invoice saves, vendor gets the amended PO
- **Why:** a phone call is not a record. The PO revision is — dated, approved,
  sent, held by both sides
- **This replaces** the earlier "amber, reason mandatory, owner approval" design

### Invoice field rules

- **PO number first and mandatory.** On pick, vendor locks, credit days arrive,
  any advance shows
- **A fully billed PO is BLOCKED**, error naming the existing invoice. The owner
  can unlock for one more invoice with a reason
- **No PO, no invoice.** A genuine unordered purchase needs a backdated PO first
- **Duplicate check is vendor + invoice number + FINANCIAL YEAR.** Vendors legally
  restart their series each year. FY from the invoice date, never typed
- **Invoice date** — future blocked, earlier than the PO blocked, over 6 months
  warns. The ITC deadline is shown
- **GST** — CGST/SGST for Punjab, IGST for outside, decided by the vendor's GSTIN.
  The other set hidden entirely
- **Taxable + tax must equal the entered total**, or blocked with the difference

### Returns

- **On a challan, unbilled** → return challan. Received quantity reduces, the PO
  line reopens, follow-up restarts
- **On an invoice, billed** → **debit note**. The bill's pending reduces and the
  vendor gets the note, so both sides agree
- Both record: document and line, quantity, reason, what you expect back
  (replacement or credit), who approved, transport
- **Pending returns list** — sent back, nothing received. Chased like a PO
- Rejection rate feeds the scorecard

### Short close

- **Two cases:** the vendor will not replace returned goods, or never supplied
- Short close the line's balance, or the whole PO
- **Not a cancellation** — part of it happened, and the history stays
- **Reason from a fixed list:** vendor unable to supply · no longer required ·
  found cheaper elsewhere · quality unacceptable · delayed beyond use
- **Always owner approval.** Delegatable later — it points at a permission
- The unsupplied quantity is recorded as **not supplied**, never as received
- **Feeds a failure-to-supply rate.** A vendor at 88% on-time who short-closes 15%
  of lines is not an 88% vendor
- A short close with zero received and no follow-ups flags to the owner — that is
  someone tidying up rather than chasing

---

## Payments

### Credit days

- One field on the vendor: 7 / 15 / 30 / 45 / 60 / 90 / Cash
- **Run from the INVOICE date, not the PO date.** One PO can bring three
  deliveries and three bills, each with its own due date

### The due list — one signed number

- `−7` = 7 days left · `0` = due today · `+3` = 3 days overdue
- Sorted highest first. Positive red, zero amber, negative plain
- **One list, no weekly buckets**
- **The bill shows its own pending amount**, and drops off only at zero

### Every payment must name its bill

- Pick vendor → open bills oldest first → tick → amount fills, editable
- **Cannot save without at least one bill**
- **Allocate oldest first**: ₹50,000 against a ₹40,000 and ₹30,000 bill fills
  ₹40,000 + ₹10,000. Any line overridable
- The split must total the payment exactly. A line cannot exceed that bill's
  pending
- Payment larger than all open bills → the remainder becomes an unused advance

### Advances

- Paid before any bill, recorded **against the PO**, not a bill
- **An advance adjusts ONLY on the PO it was paid against.** No cross-PO matching
- The bill shows both numbers: bill ₹60,000 · advance adjusted ₹50,000 ·
  pending ₹10,000
- Leftover on a completed PO stays visible against that PO. Refund, or move with
  **owner approval and a reason**, both POs recording it
- Adjustment is reversible — recorded, not deleted

### The screen shows the full position first

1. All unused advances — date, PO, amount, unused balance
2. All open bills — number, date, PO, amount, advance adjusted, pending, days
3. **One line at the top: open bills − unused advances = payable now**
   (₹2,40,000 − ₹90,000 = ₹1,50,000)

**The screen ignores PO boundaries. The automatic adjustment still does not.**

---

## Vendor scorecard

- Nothing typed. All derived
- **Minimum 3 POs before ranking.** Rolling 12 months
- **No single blended score** — separate facts, read yourself

1. **Delivery** — on-time %, average delay, date slips per PO, part-delivery rate
2. **Chase effort** — follow-ups per PO, per lakh of value
3. **Price** — against best-ever for the same item, own trend, win rate
4. **Failure to supply** — short-close rate
5. **Quality** — rejection and short-supply rate

Shown while choosing a vendor: `On-time 62% · avg 9 days late · 4.2 follow-ups
per PO`

---

## Laser cutting

- **Actual process:** drawings sent to the vendor, **the vendor buys the sheet
  himself**, ~60% one-off custom, accepted and paid **by weight**
- **Not job work** — it is the purchase of a made-to-order part. Item type
  Component, group Laser Cut Parts, bought out, unit Kg
- **Repeating drawings become permanent items.** One-off project drawings live
  under the project. Promoted after 4+ orders
- **Open PO: one per vendor covering all projects. Always owner approval.** Fixed
  ₹/kg, value limit, validity date. Warning at 80%, blocked at 100%
- **"Drawing Sent"** — file, drawing number, project, customer, estimated weight,
  expected date
- **Project, customer and weight are visible to REF only**, never to the vendor
- **WhatsApp button** opens WhatsApp Web with the file attached and the drawing
  number filled. Time and sender recorded, pendency starts
- **No Drawing Sent without an uploaded file.** This is what fixes drawings living
  on individual computers — flagged as a bigger risk than the purchase problem
- **Estimated quantity satisfies the PO. Payment is on actual weight** from the
  vendor's challan. The line prints as "estimated / approx". No tolerance rule

---

## Still open

- **The follow-up bands** — the 3/10/15-day seed may not match real behaviour
- **Purchase team performance metrics** — data captured from day one, reporting
  deferred
