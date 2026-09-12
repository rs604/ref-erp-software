# The Refcon ERP database

**Live project:** `refcon-erp` — `deevokrufinihutrvnqw`, region `ap-south-1` (Mumbai).
Built 9 Sep 2026, replacing the old Tokyo project.

## What is in this folder

| Path | What it is |
|---|---|
| `supabase/migrations/` | Every change ever made to the database, in order. This folder IS the schema. |
| `supabase/functions/` | Edge functions — small programs that run next to the database |
| `supabase/tokyo-backup/` | Frozen rescue copy of the old Tokyo project. Reference only, nothing here runs. |

## The idea behind the shape

**One list of people and companies.** `parties` holds every person and every company —
employee, vendor, customer, contractor, transporter. What someone *is* to the business is
a row in `party_roles`, not a separate table. A supervisor who also supplies transport is
one record, not two, which is the whole reason a 360° view is possible at all.

**Five concepts, nothing else:** Party · Item · Document · Event · Balance.

**Six conventions, on every table, forever:**

1. The same five columns — `id`, `created_at`, `updated_at`, `created_by`, `status`
2. Every document is a header plus lines
3. The same status words everywhere — `draft → submitted → approved → completed`, plus `cancelled`
4. Nothing is ever deleted, only cancelled
5. Human numbers (`EMP-0014`, `SAL-2026-09`) are separate from database ids
6. Balances are never typed in — they are added up from the documents

Convention 3 is enforced by a database type, not by hope: `public.record_status` rejects
any word outside the list. Convention 6 is enforced by there being no column to type a
balance into — see the `loan_balances` and `advance_balances` views.

`select public.attach_conventions('my_table')` gives a new table the standard behaviour in
one line: `updated_at` maintained, every change audited, and optionally an events row on
each status change.

## How 360° works

Every status change fires a trigger that writes one row to `events`, carrying the party,
the item and the document it touched. One query builds any timeline. A module built next
year gets its 360° screen the day it is built, with no extra work.

## Security

- **Login is Supabase Auth.** The hand-built login from Tokyo — `employees.pin`,
  `password_hash`, `employee_sessions`, `password_reset_tokens` — is retired and was not
  recreated.
- **Every table has row-level security switched on and real rules written.** The old
  project had it switched on with zero rules, which only worked because everything ran
  with the master key.
- Rules ask "who is this?" through `current_party_id()`, `is_owner()` and
  `has_permission()` — `SECURITY DEFINER` functions with `search_path` pinned, so a rule
  never reads the table it is protecting and loops forever.
- Views are `security_invoker = true`, so a view cannot be used to walk around a rule.
- **Two-step login** is `user_accounts.two_step_enabled` — a tickbox per person, off by
  default, meant for owner and accounts.
- **Every change is recorded** in `audit_log` by a trigger. **Every login** is recorded in
  `login_log`. Neither can be written from a screen.
- **Files:** only PDF, JPG and PNG, capped at 25 MB, enforced by the `attachments` table's
  own check constraint *and* by the storage buckets. A file is invisible until
  `scan_status` says `clean`. A file can never be deleted — the database raises an error
  if anything tries. `replace_attachment()` is the only way to change one, and it keeps
  the old version.
- `job_secrets` and `two_step_codes` are readable by nobody, from any screen, ever.

## Backups

Supabase's own backups need the paid plan, keep 7 days, and never include uploaded files.
So the database keeps its own.

- `nightly-backup` runs at **02:00 IST every night**, scheduled inside the database.
  Nobody has to start it.
- It exports every table to a gzipped bundle in the private `backups` bucket, and lists
  every uploaded file.
- Each run is written to `backup_runs`, so it is obvious at a glance whether last night
  worked.
- Retention is 12 months, from `app_settings.backup_retention_months`.
- **Off-site copies of uploaded files are not switched on yet.** They need a *private*
  GitHub repo and a token, set as `GITHUB_BACKUP_REPO` and `GITHUB_BACKUP_TOKEN`. Until
  then each run says so in plain words in `error_message`, rather than reporting a clean
  success while the files sit unprotected.

## Rebuilding this database from scratch

Replay `supabase/migrations/` in filename order. There is no other source of truth.
