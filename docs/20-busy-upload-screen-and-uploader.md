# Busy Data — the upload screen, the uploader, and the two owner screens

**Date:** 17 Sep 2026 · **Status:** applied to Mumbai, pushed
**Migrations 42–43 · `busy.html` · `busy/uploader/` · `busy/parse-service/`**

---

## I was wrong about what needed Windows

I said the history load needed a Windows machine. It does not. Only **compiling
the .exe** does. The load, the screen and the instructions were all buildable
here, and are now built.

---

## The obstacle turned out not to exist

> **Superseded 17 Sep 2026, same day.** I built a container because mdbtools is a
> Linux program and a Supabase edge function cannot have one. Raghbir then tested
> **`access-parser`**, a pure-Python library, against a real file — 87 tables,
> Tran1 3,591 rows, read in 6 seconds, identical output. **No system package, no
> Dockerfile, no container, no Cloud Run.**
>
> `busy/parse-service/` has been removed, and the upload screen no longer sends
> files anywhere: it reads the parser's output in the browser and loads it
> straight into the database. See `docs/21-no-parse-service.md`.

The rest of this document still stands.

---

## 1. The upload screen — Busy Data ▸ Load history

Owner only. *(Reworked the same day — it now takes the parser's rows file, not
the `.bds` files. Everything below still describes it.)*

- **Drop the rows file on it, or click to choose it**
- **It works out the firm and the year from the rows. Nothing is typed**
- The file is **read and shown on screen** — one batch per firm and year — and
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

## What is left

1. **The rows file** from the updated parser — then the load can run
2. **Build the `.exe`** on any Windows machine, upload it, set the version
