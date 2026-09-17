"""
REF ERP — Busy parse service.

The browser sends a .bds file here. This service runs the parser, works out
which firm and which financial year the file is, and hands the rows to the
database through busy_import_fy. It then answers with what happened, so the
upload screen can show it a line at a time.

WHY THIS IS NOT A SUPABASE EDGE FUNCTION:
    Edge functions run Deno in a sandbox and cannot have mdbtools installed.
    Reading a Busy .bds file needs mdb-export, which is a Linux program. So
    this runs as a small container instead -- Cloud Run, Fly.io, a cheap VPS,
    anywhere that runs Docker. See README.md.

WHAT IT NEVER DOES:
    It never writes to Busy. It reads the uploaded copy and throws it away.
    The service key never leaves this container, so no browser ever holds it.
"""

import os
import re
import io
import csv
import json
import shutil
import tempfile
import subprocess
import urllib.request
import urllib.error

from flask import Flask, request, jsonify

import busy_parser  # Raghbir's parser, used unchanged

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024  # a Busy year file is tens of MB

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Which firm a file belongs to is decided by the company name inside it.
# These are patterns, not hard-coded folder names, so a new year folder needs
# no change here.
COMPANY_PATTERNS = [
    (re.compile(r"RAGHBIR|REF\s*CONVEY|ERECTORS", re.I), "REF"),
    (re.compile(r"\bR\.?\s*S\.?\s*INDUSTRIES\b|\bRS\s*IND", re.I), "RS"),
]

# Busy keeps the company name in one of these. Tried in order.
COMPANY_TABLES = ["Company", "CompanyInfo", "Cmp", "CmpInfo", "Master1"]


def mdb_table(path, table):
    try:
        out = subprocess.run(["mdb-export", path, table],
                             capture_output=True, text=True, timeout=120)
        if out.returncode:
            return []
        return list(csv.DictReader(io.StringIO(out.stdout)))
    except Exception:
        return []


def mdb_tables(path):
    try:
        out = subprocess.run(["mdb-tables", "-1", path],
                             capture_output=True, text=True, timeout=120)
        if out.returncode:
            return []
        return [t.strip() for t in out.stdout.splitlines() if t.strip()]
    except Exception:
        return []


def financial_year_from_name(filename):
    """db12024.bds is the 2024-25 year file. db.bds is the master file and
    holds no transactions, so it is not a year at all."""
    name = os.path.basename(filename).lower()
    match = re.search(r"db1(\d{4})\.bds$", name)
    if not match:
        return None
    start = int(match.group(1))
    return "%d-%02d" % (start, (start + 1) % 100)


def company_from_file(path):
    """Read the firm's name out of the file itself rather than trusting the
    folder it happened to be in."""
    available = set(t.lower() for t in mdb_tables(path))
    for table in COMPANY_TABLES:
        if table.lower() not in available:
            continue
        for row in mdb_table(path, table)[:200]:
            for value in row.values():
                if not value:
                    continue
                for pattern, code in COMPANY_PATTERNS:
                    if pattern.search(str(value)):
                        return code, str(value).strip()
    return None, None


def caller_is_owner(bearer):
    """The browser sends its own signed-in token. We ask the database who that
    is -- we never take a claim of identity from the request body."""
    if not bearer:
        return False
    try:
        req = urllib.request.Request(
            "%s/rest/v1/rpc/is_owner" % SUPABASE_URL,
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "apikey": SERVICE_KEY,
                "Authorization": "Bearer %s" % bearer,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode()) is True
    except Exception:
        return False


def call_import(batch_id, company, fy, rows):
    payload = json.dumps({
        "p_batch_id": batch_id,
        "p_company": company,
        "p_fy": fy,
        "p_rows": rows,
    }).encode()
    req = urllib.request.Request(
        "%s/rest/v1/rpc/busy_import_fy" % SUPABASE_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "apikey": SERVICE_KEY,
            "Authorization": "Bearer %s" % SERVICE_KEY,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=900) as resp:
        return json.loads(resp.read().decode())


def rest(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        "%s/rest/v1/%s" % (SUPABASE_URL, path),
        data=data,
        headers={
            "Content-Type": "application/json",
            "apikey": SERVICE_KEY,
            "Authorization": "Bearer %s" % SERVICE_KEY,
            "Prefer": "return=representation",
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode()
    return json.loads(text) if text else None


def bearer_from(req):
    header = req.headers.get("Authorization", "")
    return header[7:] if header.lower().startswith("bearer ") else ""


@app.get("/health")
def health():
    have_mdb = shutil.which("mdb-export") is not None
    return jsonify({
        "ok": have_mdb and bool(SUPABASE_URL) and bool(SERVICE_KEY),
        "mdbtools": have_mdb,
        "configured": bool(SUPABASE_URL) and bool(SERVICE_KEY),
    })


@app.post("/probe")
def probe():
    """Work out the firm and the year WITHOUT loading anything, so the screen
    can show what it understood and Raghbir can see it is right first."""
    if not caller_is_owner(bearer_from(request)):
        return jsonify({"ok": False, "error": "Owner only."}), 403

    upload = request.files.get("file")
    if upload is None:
        return jsonify({"ok": False, "error": "No file was sent."}), 400

    fy = financial_year_from_name(upload.filename)
    tmp = tempfile.NamedTemporaryFile(suffix=".mdb", delete=False)
    try:
        upload.save(tmp.name)
        company, company_name = company_from_file(tmp.name)
    finally:
        os.unlink(tmp.name)

    if fy is None:
        return jsonify({
            "ok": False, "skip": True, "file": upload.filename,
            "error": "This is not a financial year file. db.bds holds the "
                     "parties and items, not the transactions, so there is "
                     "nothing to load from it.",
        })
    if company is None:
        return jsonify({
            "ok": False, "file": upload.filename, "fy": fy,
            "error": "Could not tell which firm this file belongs to from "
                     "inside it. Say which, and it will be loaded.",
        })

    return jsonify({"ok": True, "file": upload.filename,
                    "company": company, "company_name": company_name, "fy": fy})


@app.post("/import")
def do_import():
    if not caller_is_owner(bearer_from(request)):
        return jsonify({"ok": False, "error": "Owner only."}), 403

    upload = request.files.get("file")
    if upload is None:
        return jsonify({"ok": False, "error": "No file was sent."}), 400

    fy = request.form.get("fy") or financial_year_from_name(upload.filename)
    company = request.form.get("company")

    tmp = tempfile.NamedTemporaryFile(suffix=".mdb", delete=False)
    batch_id = None
    try:
        upload.save(tmp.name)

        if not company:
            company, _name = company_from_file(tmp.name)
        if not company or not fy:
            return jsonify({"ok": False, "file": upload.filename,
                            "error": "Could not work out the firm or the year "
                                     "for this file."}), 400

        batch = rest("POST", "busy_import_batches", {
            "company": company, "fy": fy,
            "source_file": upload.filename, "status": "draft",
        })
        batch_id = batch[0]["id"] if batch else None

        rows = busy_parser.parse_fy(tmp.name, company, fy)

        result = call_import(batch_id, company, fy, rows)
        counts = result[0] if isinstance(result, list) and result else (result or {})

        rest("PATCH", "busy_import_batches?id=eq.%s" % batch_id, {
            "status": "completed",
            "finished_at": "now()",
            "rows_read": len(rows),
            "rows_inserted": counts.get("inserted", 0),
            "rows_updated": counts.get("updated", 0),
        })

        return jsonify({
            "ok": True, "file": upload.filename, "company": company, "fy": fy,
            "rows_read": len(rows),
            "inserted": counts.get("inserted", 0),
            "updated": counts.get("updated", 0),
            "edited": counts.get("edited", 0),
            "deleted": counts.get("deleted", 0),
            "restored": counts.get("restored", 0),
        })

    except urllib.error.HTTPError as exc:
        # This is where the guard's refusal comes back. It is not a crash --
        # it is the database refusing to lose rows, and the words matter.
        detail = exc.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("message", detail)
        except Exception:
            pass
        if batch_id:
            try:
                rest("PATCH", "busy_import_batches?id=eq.%s" % batch_id,
                     {"status": "cancelled", "finished_at": "now()",
                      "error_message": detail[:2000]})
            except Exception:
                pass
        return jsonify({"ok": False, "refused": True,
                        "file": upload.filename, "error": detail}), 200

    except Exception as exc:
        if batch_id:
            try:
                rest("PATCH", "busy_import_batches?id=eq.%s" % batch_id,
                     {"status": "cancelled", "finished_at": "now()",
                      "error_message": str(exc)[:2000]})
            except Exception:
                pass
        return jsonify({"ok": False, "file": upload.filename,
                        "error": str(exc)}), 200

    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
