# Settings and Permissions — decisions locked

**Date:** 17 Sep 2026. **Status:** closed. Ready to build.

---

## SETTINGS

### The problem it solves

Every module adds switches — approval limits, chase days, HSN digits, sync
times. About **31 today**, and only purchase, items and Busy are done. It will
reach 50.

Raghbir raised the risk himself: *"it will make settings module too complicated
and remembering those all will be difficult."*

### The rule: a setting lives where it is used

- **Chase days** sit on the Follow-up screen
- **Approval limits** sit with Approvals
- **HSN digits** sit on the Item master
- **Departments and designations** sit on the Vendor and Employee masters

**Why:** you never hunt for a setting — it is on the screen where the thing
lives. And you find it by accident, because looking at gear boxes shows you the
pattern is editable.

### The exception

**Company settings have no other home**, so they live under Settings itself:
GST slabs, financial year, company header, number series.

### The Settings screen is an INDEX, not a form

**Nothing is changed from it.** It tells you where each setting lives and takes
you there.

| Column | |
|---|---|
| Sr. | |
| Setting | its name |
| What it does | **one short line.** Click the row for the full explanation in a popup, Esc to close |
| Now | the current value, so you see it without going anywhere |
| Lives on | which screen it sits on |
| Go | an arrow that takes you there |

- **Groups are a submenu under Settings in the nav**, not chips across the top.
  A chip row wraps or scrolls sideways once it grows; a submenu just gets taller
- All settings · Purchase · Items · Vendors · Busy Data · Company · Security,
  each with its count
- Below a divider in the same submenu: **What changed · Decisions · Checklist**
- Search box, focus lands in it on open
- Pagination 10 · 25 · 50 · All
- **A locked setting shows "Locked" instead of a value.** Backdated PO approval
  is one
- Owner only. Every change recorded with who and when

### On the screen where a setting lives

**Two ways to reach it, and the second matters more**

- A gear icon top right — that screen's settings
- **A line above the thing it controls showing the current value** —
  *"Chase days: 3 bands"*. Click it and the panel opens

You see what the setting currently is while looking at what it controls, without
going anywhere.

**The panel opens over the screen, not on a new page.** Esc closes it.

**Inside it**

- The setting itself, editable
- **Any locked part shown in blue** — *"One chase the day before delivery is
  always added, and cannot be removed"*
- *"Affects new orders only. Orders already raised keep their schedule."*
  Stated where someone is about to change it
- **Last changed by you, 9 Sep** — so you know if someone else moved it

### The 31 settings so far

| Module | Settings |
|---|---|
| Purchase | approval limit per role · chase days · rate warning multiple · backdated approval (locked) · days-waiting red threshold · PO value limit · quantity max |
| Items | HSN minimum digits · tolerance defaults per group · max order qty · extreme rate multiple · GST slabs |
| Vendors | map location mandatory · vendor search alert threshold · export and print threshold · bank list refresh |
| Busy Data | sync times and count · uploader version · failed sync alert · expected row counts |
| Company | GST slabs · financial year · company header · number series |
| Security | two-step login per user · file size and type limits · backup retention |

---

## PERMISSIONS

### Three separate fields on the employee record

| Field | Question | Example |
|---|---|---|
| **Department** | Where does he sit? | Purchase |
| **Designation** | What is his rank and trade? | Sr. Supervisor |
| **ERP role** | What does he do in the software? | Purchaser, Store keeper |

### Why access does NOT belong to the designation

Raghbir proposed it, for a good reason — the job should survive the person. That
requirement is right. The mechanism was not:

- **Fourteen of the seventeen designations are shop-floor trades** — Welder,
  Fitter, Latheman, Adda-man. They never touch the ERP. Tying access to them
  means inventing ERP meaning for a field that has none
- **One designation spans several departments.** A Sr. Supervisor in stores and
  one in production need completely different access
- **Designation is an HR field.** It drives salary grade and hierarchy.
  Overloading it means promoting someone silently changes what he can see
- **"Store keeper" is not in the designation list at all**

**The durability requirement is met anyway:** Ravi leaves, the next person is
ticked Purchaser and has the same access immediately. **The role survives the
person, which was the real point.**

This is the same reasoning that separated Department from ERP modules earlier:
one field cannot answer two questions.

### The roles

Purchaser · Purchase manager · Store keeper · Accounts · Supervisor ·
Production · Sales · Owner

- **Set once per role.** Everyone holding it gets it. Change the role, everyone
  changes
- **A person can hold several.** Ravi is Purchaser and Store keeper
- Multi-select dropdown, type to filter. **Not a wall of chips** — it saves the
  space
- **The dropdown shows how many people hold each role**, so you see the risk
  while assigning: *Purchaser 3 · Store keeper only him · Production nobody*
- **Owner bypasses permissions entirely.** No ticks to set

### Per person, not per role

- **Approval limit in rupees.** Two Purchasers can have different figures.
  He can never approve his own order
- **Two-step login.** A tick, off by default. For owner and accounts.
  Deliberately off for shop-floor people sharing a screen

### The matrix

**Modules down. See · Add · Change · Approve · Cancel across.**

- **There is no Delete column.** Nothing is ever deleted in this ERP — wrong
  entries are cancelled, and the cancellation is itself an event. A Delete
  column contradicts a core rule of the system
- Plain words, not View/Create/Edit/Delete
- **Dashes where an action genuinely does not apply**
- **His own modules first, already open. The rest below, collapsed**
- Each module header says which role granted it — *"from Purchaser"*
- **A row changed from its role shows amber**, with *"Reset to the role"*
- **Every permission must have a box of its own.** Two permissions sharing a
  slot means one of them can never be granted or revoked, silently

### When someone leaves

**A screen before you confirm:**

> Ravi Kumar is leaving.
> **He is the only Store keeper.** Nobody else can receive material.
> He is one of three Purchasers. Others can cover.
> Designation: Sr. Supervisor. One of two.
>
> Who takes over Store keeper? [pick someone]

**And a standing list, openable any time**

- Roles with nobody in them
- Roles with only one person — a risk, because illness or leave stops work
- Vacant designations

**The difference in one line: a vacant designation means hire someone. A vacant
role means tick someone today.**

### The Permissions tab on the employee 360

- Shows everything above, read-only. Anyone can look up what a person can do
  without opening a settings screen
- **Edit opens the permissions screen with him preselected**

### What is already decided elsewhere and must hold

- Owner-only: Settings, Decisions, Checklist, Busy Data, blacklisting, short
  close, backdated POs
- Approval ladder: purchaser ₹10,000 → manager ₹50,000 → owner
- **The purchase manager cannot reject.** Only the raiser or the owner
- **Bank details: employee and HR only. Deliberately NOT supervisors**
- Aadhaar last four digits only; the full number is not stored anywhere
- Three people see Busy Data: Raghbir, his brother, the accountant

---

## Vendor follow-up override — added to the purchase module

**A Follow-up section on the vendor form. Empty by default, not mandatory.**

- A new vendor follows the general chase rules
- When a vendor says *"stop calling so often"*, you open his record and fill it in
- Same table as the general screen: delivery within X days → chase on these days
- **Preferred contact** — WhatsApp · call · email. Some vendors answer WhatsApp
  and ignore calls
- **A note saying why** — *"Asked us not to call, 14 Sep, spoke to Rakesh."*
  In six months nobody remembers, and someone will wonder if it was a mistake

**What it does**

- **Overrides the general rules for that vendor's future POs**
- POs already raised keep their schedule. Same in-flight rule as everywhere
- Empty means the general rules apply
- Shown on the follow-up row: `Bonfiglioli — own schedule · WhatsApp only`
- **The day-before-delivery chase stays on every schedule, always**

### Rejected: named chase styles

Light, Normal and Close as three fixed sets was considered. Raghbir's version is
better — the vendor record holds its own days, edited the same way as the
general screen, so there is one mechanism to learn rather than two.

---

## Also decided today

- **PAN rule widened.** The fourth letter accepts C company · P individual ·
  F partnership firm · H HUF · T trust. C and P alone would block partnership
  firms, which Raghbir buys from
- **Purchase team performance metrics deferred.** Data captured from day one,
  reporting held back until the team is used to the system. Measuring people in
  week one of a new system teaches them to game it
- **`vendor-actions` can now be built.** It was deferred until the vendor schema
  changed in Phase 4. That has happened
- **Follow-up bands stay a setting.** Raghbir will tune them from the screen
  rather than deciding a seed now

---

## Still open

- The six Electricals sub-groups — coming with the item master file
- The item master itself — 557 rows needing Raghbir
- **His top three business pain points** — decides what is built after purchase
