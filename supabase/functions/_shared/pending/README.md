# auth.after-rename.ts

`../auth.ts` currently carries a transitional map, `RENAMED_2026_09`, that lets
three permission keys be checked under either their old or their new spelling
while the rename lands. It exists so there is no moment where the database and
the functions disagree and somebody is told they have no permission on a screen
that is theirs.

**This file is what `../auth.ts` goes back to once the rename is done.** It is
byte-for-byte the version that was deployed before the change, so the shim
leaves no trace behind it.

The order:

1. deploy `hr-actions` and `hrms-actions` with `../auth.ts` as it is now
   (either spelling accepted)
2. apply `supabase/migrations/pending/49_rename_delete_keys_to_cancel.sql`
3. copy this file over `../auth.ts` and deploy both functions again
   (only the new spelling)

If step 3 is skipped, nothing breaks — after step 2 nobody can hold the old
spelling, so the map never fires. But it is dead code pretending to be live,
which is the thing this project keeps finding and does not want.
