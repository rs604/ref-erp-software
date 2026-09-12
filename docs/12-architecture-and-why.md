# Architecture — what was built, and why

**Locked:** 10 Sep 2026.

**Why this document exists:** the code shows *what* was built. This shows *why*.
Without it, someone rebuilds the same mistakes in a year.

---

## The stack

| Layer | Choice | Why |
|---|---|---|
| Database | PostgreSQL via Supabase, **Mumbai** | Relational. Payroll needs transactions and joins |
| Region | ap-south-1 | ~40 ms from Punjab. Tokyo was ~150 ms, and a region can never be changed |
| Web app | Next.js + React, TypeScript | Standard, portable, easy to hire for |
| Live updates | **Broadcast from Database** | Supabase's own recommended method |
| Phone / kiosk | Installable web app (PWA) | App stores need developer accounts, certificates and review — none of which Raghbir can do |
| Email | Resend | Only `refconveyors.net` is DNS-verified |
| Hosting | GitHub Pages | Free, and the code is already there |
| Cost | ≈ $45/month (₹4,000) | Against ₹8,000–25,000/month for a commercial Indian HRMS |

### Rejected, and why

- **Firebase / MongoDB** — not relational
- **Convex** — good, but proprietary storage. ERP data must stay in Postgres
- **ERPNext / Odoo** — complete Indian payroll out of the box, but page-based
  with reloads, and customisation still needs a specialist. The dependency does
  not disappear, it only moves
- **Native mobile app** — dropped. Apple and Google accounts, signing
  certificates, screenshots, review queues. All human-only, all impossible here
- **`postgres_changes` for live updates** — re-evaluates permissions per client
  per row. The known cause of Supabase apps slowing down

---

## The three rules that shaped everything

**1. Raghbir will never copy-paste, run a command, or edit code.**

- Anything requiring him to configure or maintain is disqualified
- The AI does all execution
- Consequence: the PWA decision, the hosting decision, the "settings not code"
  rule for every threshold and limit

**2. Every future change needs an AI session.**

- So the code must be **boring and conventional**. No clever abstractions
- Any developer, or any AI in a fresh chat, must understand it in minutes
- Consequence: this documents folder. It is the real asset, not the code

**3. The ERP is for traceability, not accounting.**

- An accounting package is already in use
- *"This ERP is just to make sure there is no loophole in the process and
  everything is traceable: who did what when."*
- Consequence: no ledgers, no GST returns, no GSTR matching. The ERP holds the
  record and the audit trail

---

## The party spine — the most important structural decision

**One `parties` table for every person and company.** What they are to you —
employee, vendor, customer, contractor, transporter — is a **role attached to
that identity**, never a separate table.

**Why it matters here specifically**

- A supervisor who also supplies transport
- A transporter who is also a customer
- A contractor whose labourers are paid directly
- In the old Tokyo system the same human existed in `employees`, `vendors` and
  `supervisors` as three records nobody could join

**What it buys**

- One address book, one bank table, one payment run, across everything
- The 360° view works the day a new module is built, with no extra work
- Net a payable against a receivable for the same person

**Rejected:** one generic `documents` table for every transaction type. Tempting
on a diagram, a known way to ruin an ERP — loses constraints, kills query speed,
makes the database unreadable. **Shared shape, separate typed tables.**

---

## The six conventions — enforced by the database, not documented

1. **Same five columns everywhere** — `id`, `created_at`, `updated_at`,
   `created_by`, `status`
2. **Every document is header + lines**, with identical column names
3. **Same status words everywhere** — `draft → submitted → approved →
   completed`, plus `cancelled`. A database type rejects anything else
4. **Nothing is ever deleted.** Wrong entries are cancelled, and the
   cancellation is itself an event
5. **Human numbers are separate from database ids**
6. **Balances are never typed in.** They are views with no column to type into

`select public.attach_conventions('table')` gives any new table all of this in
one line.

**Convention 6 is the one people fight.** Allowing a manual balance edit is how
an ERP stops being able to explain itself.

---

## The events table — how 360° works

- Every document writes one row to a shared `events` table on every status change
- Each row carries the party, the item and the document
- One query builds any timeline
- **A module built next year gets its 360° view for free**

---

## Security — what was wrong and what fixed it

**The Tokyo system, before the rebuild**

- Every table had row-level security switched on with **zero policies**
- It only worked because every function used the master key, which ignores
  security entirely
- Functions had `verify_jwt: false` and took the caller's identity from the
  request body — **anyone who knew a UUID could act as that person**
- Temporary passwords stored in plain text

**What replaced it**

- RLS on all 45 tables, 111 real policies
- Policies ask "who is this?" through `current_party_id()`, `is_owner()`,
  `has_permission()` — `SECURITY DEFINER` with `search_path` pinned, so no
  recursion. Views are `security_invoker = true`
- **One shared file decides who is calling.** No function works it out for
  itself, and none accepts an identity from the request body
- **Proven, not assumed** — a request carrying a spoofed party, a fake approver,
  a cost of ₹99,999 and a status of "approved" was written against the real
  signed-in person, with money recalculated server-side

**Standing rules**

- Two-step login is a **tickbox per user**, off by default. For owner and
  accounts. Deliberately off for shop-floor, who share a kiosk
- Every file virus-scanned before storage. PDF, JPG, PNG only. A file's own
  first bytes are read, so an executable cannot be stored as a `.pdf`
- Files are never deleted, only replaced, old version kept
- Every login and every change recorded

**Aadhaar** — only the last four digits are stored. Nothing to mask, nothing to
leak. PAN carries the TDS weight, and the full number lives on the uploaded
document where file permissions control it.

---

## Backups

- **Supabase Pro keeps 7 days.** Team is 14 days at $599/month. The
  point-in-time add-on is $100–400/month. All absurd against a ₹4,000 system
- **No Supabase backup at any tier includes uploaded files**
- **So: our own.** A nightly export of the database *and* the storage buckets,
  scheduled inside the database, 12-month retention
- It sits outside Supabase, so it survives an account problem
- The secret lives in `job_secrets`, which no screen can read
- Move the file half to Backblaze B2 or Cloudflare R2 (₹40–80/month) when
  drawings and photos grow past a few GB

---

## Three things that silently break live updates

Put these in every build prompt:

1. **Private-channel mismatch.** If the trigger sends on a private channel, the
   client must subscribe with `private: true`. Mismatched, the client sees
   nothing and gets no error
2. **Missing `setAuth()`.** The client must call it before subscribing, or
   authorization fails silently
3. **Security rule on the wrong table.** The read policy goes on
   `realtime.messages`, not on the source table the trigger sits on

---

## Things kept in their own tables and their own code

So they lift out cleanly when the task and FMS engine is built:

- **Approval logic** — never scattered through the PO screen
- **Scheduling** — follow-up dates, recurring tasks
- **Permissions** — always pointing at a role, never a person's name

---

## Compliance notes (India)

- All four labour codes in force since 21 Nov 2025
- **50% wage rule** — excluded allowances cannot exceed 50% of total
  remuneration; the excess counts toward PF, gratuity and bonus
- **Professional tax** — Punjab, ₹200/month for most salaried staff
- **GST slabs since 22 Sep 2025: 0, 5, 18, 40.** The 12% and 28% slabs were
  abolished
- **MSME registration is Udyam registration.** One number, one certificate.
  MSME status shortens the legal payment deadline to 45 days
- **Every rate, slab and ceiling lives in a versioned config table with
  effective-from dates.** A payroll run must be reproducible exactly as it was
  originally computed

---

## The migration — why it happened

- The original system was a Supabase project called `vehicle-km-tracker`, in
  Tokyo. It began as a vehicle km tracker and grew into an ERP
- **Tokyo is ~150 ms from Punjab; Mumbai is ~40 ms.** Every click paid that
  difference, and a region can never be changed
- All data in it was fake, so nothing needed migrating — only the code
- **Its 14 functions existed nowhere but inside Supabase.** No backup, no repo.
  That is the mistake this project must never repeat
