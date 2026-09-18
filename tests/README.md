# Screen tests

The rules these tests enforce are in `docs/23-screen-tests.md`. This folder is
the machine that runs them.

## Running them

```
NODE_PATH=/opt/node22/lib/node_modules node tests/admin-permissions.test.js
```

Exit code 0 means everything passed. The output is the report: one line per
check, PASS or FAIL, in plain words.

## What it does, and what it cannot touch

A real Chromium browser opens the real page over a local web server. Nothing
reaches Supabase: `app-config.js` — the only file holding the project address
and key — is swapped for a stub, and every request to anywhere but the local
copy of the repo is refused outright. A test run cannot read or change company
data, and cannot reach the internet.

The people in `fixtures/` are invented. This repository is public, so no real
staff, vendor or price appears in a fixture. The permission rows are real
because they are the structure being tested, and they are not private.

## Adding a screen

1. Write `tests/<screen>.test.js`, copying the shape of `admin-permissions.test.js`.
2. `harness.js` gives you:
   - `serve()` — a web server over the repo
   - `open(server, page, {file, user, handlers})` — the page with `REF` stubbed
   - `snapshot(page)` — scroll, focus, popups, every field value, the address
   - `diff(before, after, expected)` — what moved, in plain words
3. Bring a control into view **before** recording the state. Otherwise the test
   driver's own scrolling gets blamed on the screen, which is how this harness
   read a clean page as broken on its first run.
4. Focus landing on the thing just clicked is correct. Pass `focusMayBe`.
5. Leave a test failing rather than deleting it when the fault is real and the
   fix needs a decision. A deleted test is a forgotten fault.

## Refreshing the recorded database signatures

`fixtures/rpc-signatures.json` is a **copy** of what the project's functions
take, and a copy drifts. `check-rpc-calls.js` refuses to pass if any migration
file is newer than that copy, because a stale copy makes the check meaningless
while still looking green.

After a migration that adds or changes a function, run this against the project
and write the answer into the file:

```sql
select json_object_agg(fn, info)::text from (
  select p.proname::text as fn,
         json_build_object(
           'args', (select coalesce(json_agg(a.name order by a.ord),'[]'::json)
                    from unnest(coalesce(p.proargnames,'{}')) with ordinality a(name, ord)
                    where a.ord <= p.pronargs),
           'total', p.pronargs,
           'with_defaults', p.pronargdefaults) as info
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
) t;
```

## Checking the call sites against the LIVE project

The offline check compares against the copy. To check against the database
itself — which is what actually answers the call — run
`node tests/list-call-sites.js`, paste its output into the `call(...)` VALUES
list in `tests/check-rpc-live.sql`, and run that against the project. Every row
must say `resolves`.

Do this after every migration that touches a function.
