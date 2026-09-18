-- ============================================================
-- Does every call site resolve against the DATABASE ITSELF?
--
-- The offline check compares the code against a recorded copy of the
-- signatures. A copy drifts. This asks the database, which is what actually
-- answers the call.
--
-- Run it after every migration that touches a function. Replace the call(...)
-- list below with the output of:  node tests/list-call-sites.js
--
-- Every row must say "resolves".
-- ============================================================
with call(where_at, fn, args) as (values
  -- >>> paste node tests/list-call-sites.js here <<<
  ('example','busy_search',array['p_company']::text[])
),
fn as (
  select p.proname::text as name,
         coalesce(p.proargnames[1:p.pronargs], '{}') as params,
         p.pronargs as total,
         p.pronargdefaults as defaulted
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
),
judged as (
  select c.where_at, c.fn, c.args, f.params,
         (f.name is not null) as exists_at_all,
         -- PostgREST resolves by NAMED arguments: every name sent must be a
         -- parameter, and every parameter not sent must have a default.
         (select coalesce(bool_and(a = any(f.params)), true) from unnest(c.args) a) as every_name_real,
         (select count(*) from unnest(f.params) with ordinality p(nm, ord)
           where nm <> all(c.args) and ord <= f.total - f.defaulted) as required_but_missing
  from call c left join fn f on f.name = c.fn
)
select where_at, fn,
       case when not exists_at_all then 'NO SUCH FUNCTION'
            when not every_name_real then 'SENDS A NAME THE FUNCTION DOES NOT HAVE: ' ||
                 (select string_agg(a, ', ') from unnest(args) a where a <> all(params))
            when required_but_missing > 0 then 'MISSES A REQUIRED ARGUMENT'
            else 'resolves' end as verdict
from judged
order by (case when not exists_at_all or not every_name_real or required_but_missing > 0
               then 0 else 1 end), where_at;
