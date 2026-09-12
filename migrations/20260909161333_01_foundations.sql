-- ============================================================
-- 01 FOUNDATIONS
-- The six conventions, expressed once, so every table can reuse them.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Convention 3: one status vocabulary, defined once ----------
create domain public.record_status as text
  not null
  default 'draft'
  check (value in ('draft','submitted','approved','completed','cancelled'));

comment on domain public.record_status is
  'The only status words allowed anywhere in this database: draft -> submitted -> approved -> completed, plus cancelled. Convention 4: nothing is deleted, it is cancelled.';

-- ---------- Who is asking? ----------
-- Written in plpgsql on purpose: the tables these read are created later, and
-- plpgsql bodies are resolved when they run, not when they are created.

create or replace function public.current_party_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  select ua.party_id into v_id
  from public.user_accounts ua
  where ua.auth_user_id = auth.uid()
    and ua.status = 'approved'
  limit 1;
  return v_id;
end;
$$;

comment on function public.current_party_id() is
  'The parties.id of the logged-in user, or null. SECURITY DEFINER with a pinned search_path so RLS policies can call it without recursing into the tables they protect.';

create or replace function public.is_owner()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_yes boolean;
begin
  select exists (
    select 1
    from public.user_accounts ua
    join public.party_roles pr on pr.party_id = ua.party_id
    where ua.auth_user_id = auth.uid()
      and ua.status = 'approved'
      and pr.role = 'owner'
      and pr.status = 'approved'
  ) into v_yes;
  return coalesce(v_yes, false);
end;
$$;

create or replace function public.has_permission(p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_yes boolean;
begin
  if public.is_owner() then
    return true;
  end if;
  select exists (
    select 1
    from public.user_accounts ua
    join public.party_permissions pp on pp.party_id = ua.party_id
    join public.permissions p on p.id = pp.permission_id
    where ua.auth_user_id = auth.uid()
      and ua.status = 'approved'
      and pp.status = 'approved'
      and p.key = p_key
  ) into v_yes;
  return coalesce(v_yes, false);
end;
$$;

comment on function public.has_permission(text) is
  'True if the logged-in user holds this permission key. Owner holds everything.';

-- ---------- Convention 1: updated_at is maintained by the database ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Record every change: who, what, when ----------
create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'completed',

  table_name    text not null,
  row_id        uuid,
  action        text not null check (action in ('insert','update','delete')),
  changed_by    uuid,
  auth_user_id  uuid,
  old_row       jsonb,
  new_row       jsonb,
  changed_keys  text[]
);

comment on table public.audit_log is
  'Every insert, update and delete on every business table. Written by a trigger, never by the application. Append-only.';

create index audit_log_table_row_idx on public.audit_log (table_name, row_id, created_at desc);
create index audit_log_changed_by_idx on public.audit_log (changed_by, created_at desc);

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

    -- updated_at alone is not a change worth recording
    if v_keys = array['updated_at'] then
      return new;
    end if;
  end if;

  insert into public.audit_log (table_name, row_id, action, changed_by, auth_user_id, old_row, new_row, changed_keys)
  values (
    tg_table_name,
    coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
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

-- ---------- Concept 4: the shared events table that makes 360 work ----------
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  status          public.record_status default 'completed',

  event_type      text not null,
  occurred_at     timestamptz not null default now(),
  actor_party_id  uuid,

  party_id        uuid,
  item_id         uuid,
  document_table  text,
  document_id     uuid,

  from_status     text,
  to_status       text,
  summary         text,
  payload         jsonb
);

comment on table public.events is
  'One row per thing that happened, written automatically by triggers. Because each row carries the party, item and document it touched, a single query builds any 360 timeline.';

create index events_party_idx on public.events (party_id, occurred_at desc);
create index events_item_idx on public.events (item_id, occurred_at desc);
create index events_document_idx on public.events (document_table, document_id, occurred_at desc);

create or replace function public.log_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_party uuid;
  v_item  uuid;
  v_new   jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  v_party := nullif(v_new ->> 'party_id', '')::uuid;
  v_item  := nullif(v_new ->> 'item_id', '')::uuid;

  insert into public.events (
    event_type, actor_party_id, party_id, item_id,
    document_table, document_id, from_status, to_status, payload
  )
  values (
    tg_table_name || '.' || new.status,
    public.current_party_id(),
    v_party,
    v_item,
    tg_table_name,
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    v_new
  );

  return new;
end;
$$;

-- ---------- Attach the conventions to a table in one line ----------
create or replace function public.attach_conventions(p_table text, p_with_events boolean default false)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  execute format(
    'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
    p_table || '_set_updated_at', p_table);

  execute format(
    'create trigger %I after insert or update or delete on public.%I for each row execute function public.log_audit()',
    p_table || '_log_audit', p_table);

  if p_with_events then
    execute format(
      'create trigger %I after insert or update on public.%I for each row execute function public.log_event()',
      p_table || '_log_event', p_table);
  end if;
end;
$$;

comment on function public.attach_conventions(text, boolean) is
  'Gives a table the standard behaviour: updated_at maintained, every change audited, and optionally an events row on each status change.';
