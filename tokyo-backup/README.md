# Backup of the Tokyo Supabase project — taken 9 Sep 2026

This folder is a rescue copy of everything that lived **only inside Supabase** and
was not in any repository.

**Source project:** `mamamjohuuacxezcwgqv` — "vehicle-km-tracker", region `ap-northeast-1` (Tokyo).

Taken immediately before the ERP was rebuilt in `ap-south-1` (Mumbai). Nothing here is live.

## What is in here

| Path | What it is |
|---|---|
| `functions/` | All 14 edge functions, source as deployed |
| `schema.sql` | Structure of all 39 tables — columns, constraints, indexes, RLS state. **No data rows.** |
| `seed.sql` | 153 rows of genuine reference data (branches, departments, designations, employee categories, relationships, holiday types, states, cities) |

## What is deliberately NOT in here

- **Table data.** Every employee, vendor, Km Tracker entry and image in the Tokyo
  project was test data. It was confirmed as fake and was not exported.
- **Storage bucket contents.** Three private buckets existed
  (`vehicle-km-photos`, `employee-documents`, `vendor-documents`). They held test
  images only.
- **`app-login/page.html` and `app-submit/page.html`.** Those two functions read a
  sibling HTML file that the Supabase API did not return. Both functions are dead
  and were dropped in the rebuild, so the file was not recovered.

## Known state of the source project at backup time

- RLS (row level security — the database's own permission rules) was switched **on**
  for all 39 tables with **zero policies written**. Everything worked only because
  every edge function used the service-role key, which ignores RLS entirely.
- No database functions, no triggers, no views existed.
- The edge functions had `verify_jwt: false` and identified the caller by an
  `employee_id` / `requester_id` sent in the request body. Anyone who knew an active
  employee's UUID could act as that employee. This is the hole the Mumbai rebuild closes.
- `erp_login_requests.temp_password` stored generated passwords in plain text.

## Cross-reference

Decisions and design principles for the rebuild live in the "ERP_Discussions & Prompts"
Claude project, docs `05-schema-design-principles.md` and `07-decisions-locked.md`.
