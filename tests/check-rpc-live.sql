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
  ('busy.html:1002','busy_doc_types',array['p_company']::text[]),
  ('busy.html:1104','busy_search_count',array['p_company','p_query','p_party','p_doc_types','p_date_from','p_date_to']::text[]),
  ('busy.html:1113','busy_search',array['p_company','p_query','p_party','p_doc_types','p_date_from','p_date_to','p_limit','p_offset']::text[]),
  ('busy.html:1199','busy_monthly_totals',array['p_company']::text[]),
  ('busy.html:1286','busy_gst_ledger',array['p_company']::text[]),
  ('busy.html:1605','busy_import_abandon',array['p_batch_id']::text[]),
  ('busy.html:1624','busy_import_stage',array['p_batch_id','p_company','p_fy','p_rows']::text[]),
  ('busy.html:1643','busy_import_finalise',array['p_batch_id','p_company','p_fy']::text[]),
  ('busy.html:1779','busy_clear_preview',array[]::text[]),
  ('busy.html:1823','busy_clear_history',array['p_confirm']::text[]),
  ('supabase/functions/admin-actions/index.ts:667','next_human_number',array['p_series_key']::text[]),
  ('supabase/functions/hr-actions/index.ts:644','current_salary',array['p_party_id']::text[]),
  ('supabase/functions/hr-actions/index.ts:1253','next_human_number',array['p_series_key']::text[]),
  ('supabase/functions/hr-actions/index.ts:1660','current_salary',array['p_party_id']::text[]),
  ('supabase/functions/hr-actions/index.ts:1676','current_salary',array['p_party_id']::text[]),
  ('supabase/functions/hr-actions/index.ts:1805','replace_attachment',array['p_old_id','p_file_name','p_mime_type','p_size_bytes','p_storage_bucket','p_storage_path','p_checksum']::text[]),
  ('supabase/functions/hr-actions/index.ts:1931','create_login_for_party',array['p_party_id','p_login_email','p_password']::text[]),
  ('supabase/functions/hrms-actions/index.ts:591','next_human_number',array['p_series_key']::text[]),
  ('supabase/functions/hrms-actions/index.ts:965','next_human_number',array['p_series_key']::text[]),
  ('supabase/functions/nightly-backup/index.ts:377','job_secret',array['p_key']::text[]),
  ('supabase/functions/nightly-backup/index.ts:458','list_public_tables',array[]::text[]),
  ('supabase/functions/nightly-backup/index.ts:659','prune_backup_runs',array[]::text[]),
  ('supabase/functions/payroll-actions/index.ts:349','current_salary',array['p_party_id','p_on']::text[]),
  ('supabase/functions/payroll-actions/index.ts:491','next_human_number',array['p_series_key']::text[])
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
