# Busy Data — the upload screen, the uploader, and the two owner screens

**Date:** 17 Sep 2026 · **Status:** applied to Mumbai, pushed
**Migrations 42–43 · `busy.html` · `busy/uploader/` · `busy/parse-service/`**

---

## I was wrong about what needed Windows

I said the history load needed a Windows machine. It does not. Only **compiling
the .exe** does. The load, the screen and the instructions were all buildable
here, and are now built.

---

## One real obstacle, and it is a deploy question

**The parser cannot run as a Supabase edge function.** Edge functions run Deno in
a sandbox and cannot have `mdb-export` installed, and reading a `.bds` file needs
it. So the parser runs as a **small container** instead — Cloud Run, Fly.io, or
any cheap box that runs Docker.

That is written and committed: `busy/parse-service/`, with a Dockerfile that
installs mdbtools, and a README with the exact Cloud Run command. Deploy it in
`asia-south1` so the rows do not cross the country twice.

Nothing else is blocked by it. Once it is running, put its address in settings:

```sql
update public.busy_sync_settings set parse_service_url = 'https://…' where id = 1;
```

---

## 1. The upload screen — Busy Data ▸ Load history

Owner only.

- **Drop the `.bds` files on it, or click to choose them**
- **It works out the firm and the year from each file. Nothing is typed**
- Every file is **checked first and shown on screen** — firm, year, size — and
  **nothing is loaded until you press the button**
- Each file then shows a progress bar while it uploads, then what happened:
  rows read, added, updated, edited, deleted
- **If the guard refuses a file it says so in red, says why, and loads nothing
  from it.** The other files carry on
- Three running totals across the top, counted from the database itself and
  turning green when they match:

| | Expected |
|---|---|
| Item rows, REF | 21,307 |
| Item rows, RS | 1,425 |
| All rows, both firms | 47,635 |

Those three numbers are **settings**, not code, so they can be corrected without
a rebuild.

**The warning you asked for is the first thing on the screen**, in red, above
everything else:

> Before you take any year off the Busy PC, do two things. Check the numbers
> below against what you expect, and keep a copy of the original files on an
> external drive. Once a year stops being uploaded it is **frozen here for good**
> — never compared again, never corrected. If a year loaded short and the file is
> gone, there is no way back.

It also warns before you close the tab mid-load.

---

## 2. The uploader source — `busy/uploader/`

Finished code, waiting for a compiler.

- `busy_uploader.py` — the program
- `config.example.txt` — the settings file to copy
- `README.md` — how to build it into an `.exe`, and how to set it up

It does exactly what doc 14 says: reads `config.txt` for the Busy folder and the
token, **uploads only files whose modified date or size has changed**, is
completely silent, never writes to Busy, and **reads its schedule from
`busy_sync_settings`** — so "twice a day" becomes "three times a day" as a
setting and nobody goes back to that PC.

To build it, on any Windows machine:

```
py -3 -m pip install pyinstaller
py -3 -m PyInstaller --onefile --noconsole --name RefBusyUploader busy_uploader.py
```

---

## 3. Download the uploader — Busy Data ▸ Download the uploader

Owner only. Shows the version, when it was last updated, and the times it runs.
The download link is signed and lasts five minutes.

Until the `.exe` exists it says so plainly and points at the source in the
repository, rather than showing a dead button.

**A new bucket was needed.** `documents` accepts only PDF, JPG and PNG — an `.exe`
is refused, and that rule must stay exactly as it is. So `app-downloads` was
created: private, owner only, for programs this ERP hands out. The rule that no
uploaded *document* can be an executable is untouched.

---

## 4. Setup instructions — Busy Data ▸ Setup instructions

Owner only, and written for somebody who has never seen any of it — which in
three years, with a new PC, may be you. Four parts:

1. **Putting the uploader on a new PC** — the folder, the two settings, the first
   silent run and how to tell it worked
2. **Making it run by itself** — Task Scheduler, step by step, including the two
   settings people miss: *Run whether user is logged on or not*, and **Start in**,
   without which it cannot find its own settings file
3. **Pointing it at a different Busy folder** — one line in Notepad
4. **If the data stops arriving** — a five-step list, starting with the "as at"
   time on every screen, ending with "was the PC replaced, start from the top"

It also says you should not have to watch for it: the ERP emails you if the sync
fails for the number of days in settings.

---

## What is not verified

The parse service has **never been run against a real `.bds` file** — there are
none here and mdbtools is not installed in this container. The parser inside it
is yours, unchanged. Two things in my wrapper are a best reading and need
checking on the first real file:

- **The year, from the filename** — `db12024.bds` read as 2024-25
- **The firm, from inside the file** — the company name looked for in `Company`,
  `CompanyInfo`, `Cmp`, `CmpInfo` and `Master1`, matched against
  "RAGHBIR / ERECTORS" and "RS INDUSTRIES"

That is exactly why the screen **probes every file and shows what it understood
before loading anything**. If it reads one wrongly it will be obvious on screen,
and nothing will have been written.

---

## What is left

1. **Deploy the parse service** and put its address in settings — then the load
   can run
2. **Build the `.exe`** on any Windows machine, upload it, set the version
