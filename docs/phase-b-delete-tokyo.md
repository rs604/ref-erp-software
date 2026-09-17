# Phase B — delete the Tokyo project

**Date:** 12 Sep 2026
**Target:** `mamamjohuuacxezcwgqv` — `vehicle-km-tracker`, `ap-northeast-1` (Tokyo)
**Status: NOT COMPLETE — the deletion needs a human. See "Why" below.**

## Identity confirmed

The target was checked before anything else, so there is no doubt which project
is meant:

| Field | Value |
|---|---|
| ref | `mamamjohuuacxezcwgqv` |
| name | `vehicle-km-tracker` |
| region | `ap-northeast-1` (Tokyo) |
| status | `INACTIVE` (paused) |
| created | 31 Jul 2026 |
| organization | `eublhligetilqvtifnrb` — Raghbir Erectors & Fabricators (free plan) |

## Why it is not done

**Supabase does not expose project deletion to this session.** The Supabase MCP
server offers `create_project`, `pause_project`, `restore_project` and
`delete_branch` — but there is no `delete_project`. Deleting a project is
deliberately dashboard-and-API only.

The other two routes were checked and are both closed:

- The Supabase CLI is not installed in this environment.
- No Supabase management API token is present. The only token in the
  environment is an unrelated Google Cloud one.

So the deletion has to be done by hand. Nothing was worked around or forced.

## What you need to do — about 30 seconds

1. Open <https://supabase.com/dashboard/project/mamamjohuuacxezcwgqv/settings/general>
2. Scroll to the bottom, **Delete project**
3. Type `vehicle-km-tracker` to confirm

A paused project can be deleted directly; it does not need restoring first.

## The free-tier slot — the premise was wrong, and this matters

The task said to confirm the free-tier slot is released after deleting Tokyo.
Checked against Supabase's own billing documentation:

> "You are entitled to two active free projects. **Paused projects do not count
> towards your quota.**"
> — <https://supabase.com/docs/guides/platform/billing-faq>

**Tokyo is already paused, so it is already not using a slot.** Deleting it will
free nothing, because the pause freed it back in the summer. The current picture:

| Project | Region | Status | Uses a slot? |
|---|---|---|---|
| `deevokrufinihutrvnqw` — refcon-erp | ap-south-1 | ACTIVE_HEALTHY | **yes** |
| `xxzoatpeoyktodvmjbks` — ref-conveyors-pm-tool | ap-south-1 | ACTIVE_HEALTHY | **yes** |
| `mamamjohuuacxezcwgqv` — vehicle-km-tracker | ap-northeast-1 | INACTIVE | no |
| `pwyldmxbcmwcnxujkfnk` — CRM | ap-northeast-2 | INACTIVE | no |

Both free slots are taken, by the two projects that are meant to be running.
Deleting Tokyo leaves it at two of two. **To start a third active project, one of
the two live ones must be paused, or the organization must go to Pro.** Deleting
Tokyo and CRM will not change that.

Tokyo is still worth deleting — it removes a dead project holding fake data and
live credentials, and removes any chance of someone pointing at the wrong
database. Just not for slot reasons.

## The backup was verified before recommending deletion

`supabase/tokyo-backup/` is the only record that will survive. It was checked and
is complete:

- `schema.sql` — 976 lines, **39 tables** of DDL
- `seed.sql` — 188 lines
- `functions/` — all 14 Tokyo edge functions
- `tokyo-config-reference.md` — the real, non-fake configuration: 27 permission
  keys, the `app_settings` row, the three storage bucket names

The config reference already records that bucket contents were test images and
were not copied. Everything of value is in the repo.

## Not touched

- `pwyldmxbcmwcnxujkfnk` (CRM) — left alone as instructed, pending your review
- `xxzoatpeoyktodvmjbks` (ref-conveyors-pm-tool) — never touched
- `deevokrufinihutrvnqw` (refcon-erp) — never touched

No project was paused, restored, modified or deleted in this phase. The only
calls made were read-only: `list_projects`, `get_project`, `get_organization`,
`get_cost` and a documentation search.
