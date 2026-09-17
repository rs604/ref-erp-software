"""
REF ERP — Busy uploader.

Runs on the accountant's PC under Task Scheduler. It does ONE job: copy the
Busy files up to the ERP. It does not parse them, and it never writes to Busy.

Why it does not parse:
    nothing has to be installed on that PC beyond this one program. No Python,
    no Access driver, no Busy licence. When the parsing rules change they change
    in the ERP and this PC is never touched again. New accountant, new PC, new
    version of Busy -- the upload still works.

It is COMPLETELY SILENT. No window, no popup, no tray icon. It copies, uploads
and exits. If it cannot work, it says so to the ERP, and the ERP emails Raghbir
after the number of failed days set in busy_sync_settings.

Build it into a single .exe with PyInstaller -- see README.md in this folder.
"""

import os
import sys
import json
import time
import hashlib
import datetime
import urllib.request
import urllib.error
import urllib.parse

HERE = os.path.dirname(os.path.abspath(sys.argv[0]))
CONFIG_PATH = os.path.join(HERE, "config.txt")
STATE_PATH = os.path.join(HERE, "uploader_state.json")
LOG_PATH = os.path.join(HERE, "uploader.log")

# Where Busy usually puts itself. Offered on first run so nobody has to
# go hunting for the folder.
COMMON_BUSY_FOLDERS = [
    r"C:\BusyWin\Data",
    r"C:\Busy\Data",
    r"C:\Program Files\Busy\Data",
    r"C:\Program Files (x86)\Busy\Data",
    r"D:\BusyWin\Data",
    r"D:\Busy\Data",
]


def log(message):
    """A small local log, so a person standing at the PC can see what happened.
    It is not how problems are reported -- the ERP is."""
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write("%s  %s\n" % (datetime.datetime.now().isoformat(timespec="seconds"), message))
    except Exception:
        pass


def read_config():
    """config.txt sits beside the .exe. Two lines matter:
           busy_folder = C:\\BusyWin\\Data
           upload_token = ...
       Anything after a # is a note."""
    if not os.path.exists(CONFIG_PATH):
        return {}
    out = {}
    with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#", 1)[0].strip()
            if not line or "=" not in line:
                continue
            key, value = line.split("=", 1)
            out[key.strip().lower()] = value.strip()
    return out


def write_config(cfg):
    lines = [
        "# REF ERP — Busy uploader settings.",
        "# This file sits beside the program. Change the folder here if Busy moves.",
        "",
        "busy_folder = %s" % cfg.get("busy_folder", ""),
        "upload_token = %s" % cfg.get("upload_token", ""),
        "erp_url = %s" % cfg.get("erp_url", ""),
        "",
    ]
    with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


def find_busy_folder():
    """First run only: look in the usual places and take the first one that
    actually holds Busy files."""
    for folder in COMMON_BUSY_FOLDERS:
        if os.path.isdir(folder) and list_busy_files(folder):
            return folder
    return None


def list_busy_files(root):
    """Every .bds under the Busy folder. locks.sys and everything else is
    ignored. The file is only READ -- never opened through Busy, never written."""
    found = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if name.lower().endswith(".bds"):
                path = os.path.join(dirpath, name)
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                found.append({
                    "path": path,
                    "name": name,
                    "folder": os.path.basename(dirpath),
                    "size": stat.st_size,
                    "modified": int(stat.st_mtime),
                })
    return found


def read_state():
    if not os.path.exists(STATE_PATH):
        return {}
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def write_state(state):
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh)
    os.replace(tmp, STATE_PATH)


def post(url, token, payload=None, data=None, content_type="application/json", timeout=600):
    headers = {"Authorization": "Bearer %s" % token}
    if data is None:
        data = json.dumps(payload or {}).encode("utf-8")
        headers["Content-Type"] = "application/json"
    else:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", "replace")
    try:
        return json.loads(body)
    except ValueError:
        return {"raw": body}


def should_run_now(schedule):
    """The schedule lives in the ERP, not here. Task Scheduler wakes this
    program often; it only does the work when the ERP says a run is due.
    Changing "twice a day" to "three times a day" is then a setting, and
    nobody has to come back to this PC."""
    if not schedule.get("is_enabled", True):
        return False
    times = schedule.get("run_at_times") or []
    if not times:
        return True

    now = datetime.datetime.now()
    state = read_state()
    last = state.get("last_run_iso")
    last_dt = None
    if last:
        try:
            last_dt = datetime.datetime.fromisoformat(last)
        except ValueError:
            last_dt = None

    for slot in times:
        try:
            hh, mm = str(slot).split(":")[:2]
            due = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        except Exception:
            continue
        if now >= due and (last_dt is None or last_dt < due):
            return True
    return False


def main():
    cfg = read_config()
    erp_url = cfg.get("erp_url", "").rstrip("/")
    token = cfg.get("upload_token", "")
    folder = cfg.get("busy_folder", "")

    if not erp_url or not token:
        log("config.txt has no erp_url or no upload_token. Nothing done.")
        return 2

    # First run: find the Busy folder once, then remember it.
    if not folder or not os.path.isdir(folder):
        guess = find_busy_folder()
        if not guess:
            log("Cannot find the Busy folder. Put it in config.txt as busy_folder.")
            return 2
        cfg["busy_folder"] = folder = guess
        write_config(cfg)
        log("Busy folder found and saved: %s" % folder)

    # The ERP decides whether a run is due.
    try:
        schedule = post("%s/busy-sync-schedule" % erp_url, token, {})
    except Exception as exc:
        log("Could not ask the ERP for the schedule: %s" % exc)
        return 1

    if not should_run_now(schedule):
        return 0

    files = list_busy_files(folder)
    if not files:
        log("No .bds files under %s" % folder)
        try:
            post("%s/busy-sync-report" % erp_url, token,
                 {"status": "failed", "error": "No .bds files found in %s" % folder})
        except Exception:
            pass
        return 1

    state = read_state()
    seen = state.get("files", {})
    sent = 0
    failed = 0

    for item in files:
        mark = "%s:%s" % (item["modified"], item["size"])
        # Only files whose modified date or size has changed since last time.
        if seen.get(item["path"]) == mark:
            continue
        try:
            with open(item["path"], "rb") as fh:
                blob = fh.read()
            url = "%s/busy-upload?file=%s&folder=%s" % (
                erp_url,
                urllib.parse.quote(item["name"]),
                urllib.parse.quote(item["folder"]),
            )
            result = post(url, token, data=blob, content_type="application/octet-stream")
            if result.get("ok"):
                seen[item["path"]] = mark
                sent += 1
                log("Sent %s (%s rows)" % (item["name"], result.get("rows", "?")))
            else:
                failed += 1
                log("ERP refused %s: %s" % (item["name"], result.get("error")))
        except Exception as exc:
            failed += 1
            log("Could not send %s: %s" % (item["name"], exc))

    state["files"] = seen
    state["last_run_iso"] = datetime.datetime.now().isoformat(timespec="seconds")
    write_state(state)

    try:
        post("%s/busy-sync-report" % erp_url, token, {
            "status": "completed" if failed == 0 else "failed",
            "files_sent": sent,
            "files_failed": failed,
            "error": None if failed == 0 else "%d file(s) were refused" % failed,
        })
    except Exception as exc:
        log("Could not tell the ERP how it went: %s" % exc)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # never show a crash box on that PC
        log("Stopped unexpectedly: %s" % exc)
        sys.exit(1)
