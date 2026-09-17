# Migrations waiting on something else

A migration in here is **written and reviewed but deliberately not applied**,
because applying it before something else happens would break a live screen.
Each file says at the top what has to happen first.

They are not in `supabase/migrations/` because everything there has been
applied and is verified against the database by md5. A file sitting there
unapplied would be indistinguishable from drift.

When the condition at the top of a file is met, apply it and move it into
`supabase/migrations/` with its real timestamp prefix.
