-- ============================================================
-- A RULE WRITTEN AND NEVER APPLIED
--
-- Row-level security decides WHICH ROWS a person may see. The SELECT
-- grant decides whether they may reach the table at all. A table with a
-- read policy for `authenticated` and no grant behind it is a rule
-- written and never applied: the policy looks right in every review, and
-- every read is refused before the policy is ever consulted.
--
-- busy_history sat like that. The Load history counters read it through
-- two security_invoker views, were refused, and the screen wrote the
-- refusal down as the number 0 -- on a table holding 98,644 rows.
--
-- Run this against the project after any migration that adds a table, a
-- policy or a view. Every row must say "reachable".
--
-- The same question the other way round is asked too: a table granted to
-- `authenticated` with row-level security on but NO policy is open to
-- nobody, and a table with security OFF is open to everybody.
-- ============================================================
with t as (
  select c.oid, c.relname::text as name, c.relrowsecurity as rls,
         has_table_privilege('authenticated', c.oid, 'SELECT') as granted,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname
             and p.roles::text like '%authenticated%'
             and p.cmd in ('SELECT','ALL')) as read_policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname not like 'pg_%'
)
select name,
       case
         when rls and read_policies > 0 and not granted
           then 'POLICY WITH NO GRANT — every read is refused before the policy is read'
         when rls and read_policies = 0 and granted
           then 'GRANTED BUT NO POLICY — reachable and returns nothing, which reads as empty'
         when not rls and granted
           then 'NO ROW SECURITY — every signed-in person sees every row'
         else 'reachable'
       end as verdict,
       rls, granted, read_policies
from t
order by (case when rls and read_policies > 0 and not granted then 0
               when rls and read_policies = 0 and granted then 1
               when not rls and granted then 2 else 3 end), name;
