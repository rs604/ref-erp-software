-- app_settings uses id = 1 (there is only ever one row), so the audit
-- trail cannot assume every id is a uuid.
alter table public.audit_log alter column row_id type text using row_id::text;

create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_keys text[];
begin
  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(e.key), '{}')
      into v_keys
    from jsonb_each(v_new) e
    where v_new -> e.key is distinct from v_old -> e.key;

    if v_keys = array['updated_at'] then
      return new;
    end if;
  end if;

  insert into public.audit_log (table_name, row_id, action, changed_by, auth_user_id, old_row, new_row, changed_keys)
  values (
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    lower(tg_op),
    public.current_party_id(),
    auth.uid(),
    v_old,
    v_new,
    v_keys
  );

  return coalesce(new, old);
end;
$$;
