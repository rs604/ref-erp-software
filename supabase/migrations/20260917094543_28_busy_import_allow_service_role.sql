-- ============================================================
-- 28 THE IMPORT GUARD WAS TOO TIGHT
--
-- busy_import_rows() allowed only a signed-in person holding
-- busy_data.import, or the owner. That is right for the screen Raghbir
-- uploads through, but it would have REFUSED the twice-daily automatic
-- sync, which arrives through an edge function running as the service
-- role with no signed-in user at all.
--
-- Caught by testing the function rather than assuming it worked.
-- ============================================================

create or replace function public.busy_import_rows(p_batch_id uuid, p_rows jsonb)
returns table (inserted int, updated int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_before bigint; v_after bigint; v_touched int; v_role text;
begin
  begin
    v_role := coalesce(auth.role(), current_user);
  exception when others then
    v_role := current_user;
  end;

  -- Three lawful callers: the automatic sync (service role), a person
  -- holding the import permission, and the owner. Nobody else.
  if not (v_role in ('service_role','postgres','supabase_admin')
          or public.has_permission('busy_data.import')
          or public.is_owner()) then
    raise exception 'You do not have permission to import Busy files.'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_before from public.busy_history;

  with incoming as (
    select
      r->>'company'                              as company,
      r->>'fy'                                   as fy,
      r->>'doc_type'                             as doc_type,
      r->>'vch_type'                             as vch_type,
      r->>'vch_no'                               as vch_no,
      -- Busy writes MM/DD/YY. Converted explicitly, never by implicit cast.
      case when nullif(r->>'vch_date','') is null then null
           else to_date(r->>'vch_date', 'MM/DD/YY') end as vch_date,
      r->>'party'                                as party,
      (r->>'sr_no')::int                         as sr_no,
      r->>'item'                                 as item,
      nullif(r->>'description','')               as description,
      (r->>'qty')::numeric                       as qty,
      (r->>'rate')::numeric                      as rate,
      (r->>'amount')::numeric                    as amount,
      (r->>'cgst')::numeric                      as cgst,
      (r->>'sgst')::numeric                      as sgst,
      (r->>'igst')::numeric                      as igst,
      (r->>'gst_rate')::numeric                  as gst_rate,
      (r->>'vch_total')::numeric                 as vch_total,
      r->>'search_text'                          as search_text,
      r->>'source_file'                          as source_file
    from jsonb_array_elements(p_rows) r
  )
  insert into public.busy_history (
    company, fy, doc_type, vch_type, vch_no, vch_date, party, sr_no, item,
    description, qty, rate, amount, cgst, sgst, igst, gst_rate, vch_total,
    search_text, source_file, import_batch_id)
  select company, fy, doc_type, vch_type, vch_no, vch_date, party, sr_no, item,
         description, qty, rate, amount, cgst, sgst, igst, gst_rate, vch_total,
         search_text, source_file, p_batch_id
  from incoming
  on conflict (company, fy, vch_type, vch_no, sr_no) do update set
    doc_type = excluded.doc_type, vch_date = excluded.vch_date,
    party = excluded.party, item = excluded.item,
    description = excluded.description, qty = excluded.qty,
    rate = excluded.rate, amount = excluded.amount,
    cgst = excluded.cgst, sgst = excluded.sgst, igst = excluded.igst,
    gst_rate = excluded.gst_rate, vch_total = excluded.vch_total,
    search_text = excluded.search_text, source_file = excluded.source_file,
    import_batch_id = excluded.import_batch_id, imported_at = now();

  get diagnostics v_touched = row_count;
  select count(*) into v_after from public.busy_history;

  inserted := (v_after - v_before)::int;
  updated  := v_touched - inserted;
  return next;
end;
$$;

revoke all on function public.busy_import_rows(uuid, jsonb) from public, anon;
