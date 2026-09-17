# The Busy parse service

The browser sends a `.bds` file here. This service runs the parser, works out
which firm and year the file is, and hands the rows to the database through
`busy_import_fy`.

---

## Why this is a container and not a Supabase edge function

Reading a Busy file needs **`mdb-export`**, a Linux program from mdbtools.
Supabase edge functions run Deno in a sandbox and **cannot have it installed**.
So the parser runs here instead: Cloud Run, Fly.io, or any cheap box that runs
Docker.

This was the one real obstacle to the history load, and it is a deploy question,
not a Windows one.

---

## What it does

| Route | What it is for |
|---|---|
| `GET /health` | Says whether mdbtools is present and the keys are set |
| `POST /probe` | Works out the firm and year **without loading anything**, so the screen can show what it understood first |
| `POST /import` | Parses the file and loads it, and answers with the counts |

**It never writes to Busy.** It reads the uploaded copy and deletes it.

---

## Security

- **The service key never leaves this container.** No browser ever holds it
- Every request must carry the caller's own signed-in token, and the service
  asks the database `is_owner()` with that token before doing anything. It never
  believes an identity sent in the request body — that was the hole in the old
  Tokyo system
- A refusal from the import guard comes back as plain words, not a crash, so the
  screen can show exactly which file was refused and why

---

## Deploying it

Two environment variables, both secret:

```
SUPABASE_URL          https://deevokrufinihutrvnqw.supabase.co
SUPABASE_SERVICE_KEY  the service_role key from Supabase ▸ Settings ▸ API
```

**Google Cloud Run** — simplest, and free for this amount of use:

```
gcloud run deploy busy-parse \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --timeout 900 \
  --set-env-vars SUPABASE_URL=https://deevokrufinihutrvnqw.supabase.co \
  --set-secrets SUPABASE_SERVICE_KEY=busy-service-key:latest
```

`asia-south1` is Mumbai — the same place as the database, so the rows do not
cross the country twice.

`--allow-unauthenticated` is safe here because the service checks the caller's
own token itself. Cloud Run's own gate would block the browser before it could
present one.

**Fly.io** works the same way: `fly launch`, then `fly secrets set`.

Once it is deployed, put its address into the ERP so the upload screen knows
where to send files:

```sql
update public.busy_sync_settings set parse_service_url = 'https://…' where id = 1;
```

---

## Checking it before trusting it

```
curl https://YOUR-SERVICE/health
```

Expect `{"ok": true, "mdbtools": true, "configured": true}`. If `mdbtools` is
false the image built wrong; if `configured` is false the environment variables
are missing.

---

## Not verified here

This code has **never been run against a real `.bds` file** — there are none in
the build container and mdbtools is not installed there. The parser inside it is
Raghbir's own, unchanged and proven against 24 files, but two things in *this*
wrapper are my best reading and need checking on the first real file:

- **Working out the year from the filename** — `db12024.bds` is read as 2024-25
- **Working out the firm from inside the file** — the company name is looked for
  in `Company`, `CompanyInfo`, `Cmp`, `CmpInfo` and `Master1`, and matched
  against "RAGHBIR / ERECTORS" and "RS INDUSTRIES"

That is exactly why `/probe` exists and why the upload screen shows what it
worked out **before** anything is loaded. If it reads a file wrongly, it will be
obvious on screen and nothing will have been written.
