-- ============================================================
-- 02 REFERENCE LISTS + HUMAN NUMBERING
-- Every table here has the same five columns. Nothing is deleted;
-- a list entry that is no longer used is set to 'cancelled'.
-- ============================================================

-- ---------- Convention 5: human numbers are separate from database ids ----------
create table public.number_series (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'approved',

  series_key   text not null unique,
  prefix       text not null,
  pad_width    int  not null default 4 check (pad_width between 1 and 10),
  include_year boolean not null default false,
  next_number  bigint not null default 1 check (next_number > 0),
  description  text
);

comment on table public.number_series is
  'Where EMP-0014 and PO-2026-0042 come from. The uuid stays hidden; this is the number people say out loud.';

create or replace function public.next_human_number(p_series_key text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.number_series%rowtype;
  v_n bigint;
begin
  update public.number_series
     set next_number = next_number + 1
   where series_key = p_series_key
     and status = 'approved'
  returning * into s;

  if not found then
    raise exception 'Number series % does not exist or is not active', p_series_key;
  end if;

  v_n := s.next_number - 1;

  return s.prefix || '-'
       || case when s.include_year then to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' else '' end
       || lpad(v_n::text, s.pad_width, '0');
end;
$$;

-- ---------- The lookup lists ----------
-- All seven share exactly the same shape.

create table public.states (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null unique
);

create table public.cities (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null,
  state_id   uuid not null references public.states(id),
  unique (state_id, name)
);
create index cities_state_idx on public.cities (state_id);

create table public.branches (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null unique
);

create table public.departments (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null unique
);

create table public.designations (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null unique
);

create table public.employee_categories (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null unique
);

create table public.relationships (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null unique
);

create table public.holiday_types (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null unique
);

comment on table public.states is 'Reference list. status approved = in use, cancelled = retired.';
comment on table public.cities is 'Reference list, belongs to a state.';

-- ---------- Attach the conventions ----------
select public.attach_conventions('number_series');
select public.attach_conventions('states');
select public.attach_conventions('cities');
select public.attach_conventions('branches');
select public.attach_conventions('departments');
select public.attach_conventions('designations');
select public.attach_conventions('employee_categories');
select public.attach_conventions('relationships');
select public.attach_conventions('holiday_types');
