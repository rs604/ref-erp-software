# Phase A — repo tidy

**Date:** 12 Sep 2026
**Branch:** `claude/youthful-thompson-029xon`
**Status:** done

## What the problem was

The repo was uploaded by hand, so three folders existed twice — once at the top
level and once under `supabase/`. A reader had no way to tell which copy was the
real one, and a future edit to the wrong copy would have been silently lost.

## What was checked before removing anything

Every top-level copy was compared against its `supabase/` twin with `diff -r`.
All three came back **byte-identical**, so nothing was lost by removing them:

| Folder | Files | Result |
|---|---|---|
| `functions/` vs `supabase/functions/` | 12 | identical |
| `migrations/` vs `supabase/migrations/` | 21 | identical |
| `tokyo-backup/` vs `supabase/tokyo-backup/` | 18 | identical |

`README.md` and `supabase/README.md` were also identical.

The site files and `admin.html` were searched for any path pointing at the
top-level copies. The only hit was the English word "functions" inside a code
comment, not a path. There is no CI workflow, no `config.toml` and no build step
that referenced them.

## What changed

**Removed** — the three top-level duplicates (51 files):

- `functions/`
- `migrations/`
- `tokyo-backup/`

**Kept exactly where they were** — `README.md` and the nine site files:

`CNAME` · `admin.html` · `app-config.js` · `documentation.js` · `index.html` ·
`logo.png` · `reset.html` · `submit.html` · `version.txt`

**Edited** — `README.md`. Its "What is in this folder" table listed
`migrations/`, `functions/` and `tokyo-backup/` at the top level. Those paths
would have been wrong the moment the duplicates were removed, so they now read
`supabase/migrations/`, `supabase/functions/` and `supabase/tokyo-backup/`. The
"Rebuilding this database from scratch" line was corrected the same way. No
other wording was touched. `supabase/README.md` was left alone — its paths are
correct relative to its own folder.

## Layout now

```
README.md              docs/                  supabase/
CNAME                                           README.md
admin.html                                      functions/       12 files
app-config.js                                   migrations/      21 files
documentation.js                                tokyo-backup/    18 files
index.html
logo.png
reset.html
submit.html
version.txt
```

## Note for the next phase

`docs/` did not exist in this repo before this commit — it was created to hold
this report. The four documents named at the start of the task
(`claude/00-how-to-communicate-with-raghbir.md`, `claude/09-purchase-and-vendor-decisions.md`,
`claude/10-item-master-decisions.md`, and the contents of `docs/`) are not present
in the working tree, on either branch, or anywhere in the git history. Only
`README.md` was available to read. This blocks Phases C and D, which depend on
docs 09 and 10 for their detail. Phase A did not depend on them.
