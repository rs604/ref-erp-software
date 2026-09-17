# The Busy uploader

One small program that runs on the accountant's PC and copies the Busy files up
to the ERP. **It does not parse them, and it never writes to Busy.**

---

## Why it does not parse

Nothing has to be installed on that PC beyond this one program — no Python, no
Access driver, no Busy licence. When the parsing rules change they change in the
ERP, and that PC is never touched again. New accountant, new PC, new version of
Busy: the upload still works.

---

## What it does, in order

1. Reads `config.txt` sitting beside it — the Busy folder and the upload token
2. Asks the ERP whether a run is due. **The schedule lives in the ERP**, in
   `busy_sync_settings`, so "twice a day" becomes "three times a day" as a
   setting and nobody has to come back to this PC
3. Finds every `.bds` file under the Busy folder. `locks.sys` is ignored
4. Sends only files whose **modified date or size has changed** since last time
5. Tells the ERP how it went. If it fails for the number of days set in
   `failure_email_after_days`, the ERP emails Raghbir — so a sync that quietly
   stops is noticed, instead of being found out when a price is needed

It is **completely silent**: no window, no popup, no tray icon. It copies,
uploads and exits.

---

## Building the .exe

This needs a Windows machine. It was not built here because this is a Linux
container with no Windows compiler — the code is finished and waiting.

```
py -3 -m pip install pyinstaller
py -3 -m PyInstaller --onefile --noconsole --name RefBusyUploader busy_uploader.py
```

The `.exe` appears in `dist\RefBusyUploader.exe`. Put it in a folder of its own
with `config.txt` beside it.

- `--onefile` — one file, nothing to install
- `--noconsole` — no black window flashing up when Task Scheduler runs it

**After building, upload the `.exe` to the ERP** so it can be downloaded from
Busy Data ▸ Download the uploader, and set the version there. That screen is
how a future PC gets it.

---

## Setting it up on a PC

Full step-by-step, in plain language, is inside the ERP at
**Busy Data ▸ Setup instructions**. It is written for somebody who has never
seen this before, because in three years that person may be Raghbir with a new
PC. In short:

1. Make a folder, e.g. `C:\RefUploader`
2. Put `RefBusyUploader.exe` and `config.txt` in it
3. Fill in `erp_url` and `upload_token` in `config.txt`. Leave `busy_folder`
   blank the first time and it will find it
4. Task Scheduler ▸ Create Task
   - Run whether the user is logged on or not
   - Trigger: daily, repeat every 1 hour
   - Action: start `C:\RefUploader\RefBusyUploader.exe`
   - Start in: `C:\RefUploader`
5. Run it once by hand and check `uploader.log` says something sensible

The task runs every hour on purpose. The program itself decides whether a run is
actually due, by asking the ERP. That way the times are changed in the ERP and
never in Task Scheduler.

---

## Files it writes, all beside the .exe

| File | What it is |
|---|---|
| `config.txt` | The folder and the token. Yours to edit |
| `uploader_state.json` | What was sent last time, so unchanged files are skipped |
| `uploader.log` | A short local log. Handy standing at the PC; the ERP is the real record |

---

## The token

`upload_token` is a password. Anyone holding it can send files to the ERP. Keep
it out of email, and if the PC is replaced or sold, change it in the ERP first.
