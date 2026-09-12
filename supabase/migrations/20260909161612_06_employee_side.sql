-- ============================================================
-- 06 THE EMPLOYEE SIDE
-- employee_details hangs off parties. It holds only what is true
-- BECAUSE someone is an employee. Name, address, bank and contact
-- stay on the spine, shared with vendors and customers.
-- ============================================================

create table public.employee_details (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  status                 public.record_status default 'draft',

  party_id               uuid not null unique references public.parties(id),

  branch_id              uuid references public.branches(id),
  department_id          uuid references public.departments(id),
  designation_id         uuid references public.designations(id),
  employee_category_id   uuid references public.employee_categories(id),
  reports_to_party_id    uuid references public.parties(id),

  date_of_joining        date,
  date_of_confirmation   date,
  date_of_leaving        date,
  leaving_reason         text,

  employment_state       text not null default 'active'
                           check (employment_state in ('active','suspended','left')),

  esi_number             text,
  uan_number             text,
  pf_applicable          boolean not null default false,
  esi_applicable         boolean not null default true,

  rate_per_km            numeric(10,2) check (rate_per_km >= 0),
  work_location          text,
  emergency_contact_name text,
  emergency_contact_no   text check (emergency_contact_no ~ '^[6-9][0-9]{9}$'),

  check (date_of_leaving is null or date_of_joining is null or date_of_leaving >= date_of_joining)
);

comment on table public.employee_details is
  'The employee-only facts. Everything shared with vendors and customers lives on parties and its child tables.';
comment on column public.employee_details.employment_state is
  'Working state of the person. Separate from status, which is the approval state of this record.';

create index employee_details_branch_idx     on public.employee_details (branch_id);
create index employee_details_department_idx on public.employee_details (department_id);
create index employee_details_state_idx      on public.employee_details (employment_state);

-- ---------- Salary: never overwritten, always a new dated record ----------
create table public.salary_records (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  status           public.record_status default 'draft',

  party_id         uuid not null references public.parties(id),
  effective_from   date not null,
  basic            numeric(12,2) not null default 0 check (basic >= 0),
  hra              numeric(12,2) not null default 0 check (hra >= 0),
  da               numeric(12,2) not null default 0 check (da >= 0),
  ta               numeric(12,2) not null default 0 check (ta >= 0),
  other_allowance  numeric(12,2) not null default 0 check (other_allowance >= 0),
  reason           text not null check (reason in ('joining','appraisal','promotion','correction','other')),
  approved_by      uuid references public.parties(id),
  remarks          text,

  unique (party_id, effective_from)
);

comment on table public.salary_records is
  'A salary is never edited. A change adds a new row with an effective-from date. Past payroll stays reproducible and increment history comes free.';

create index salary_records_party_idx on public.salary_records (party_id, effective_from desc);

-- Current salary = the newest record whose date has already arrived.
create or replace function public.current_salary(p_party_id uuid, p_on date default current_date)
returns public.salary_records
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.*
  from public.salary_records s
  where s.party_id = p_party_id
    and s.effective_from <= p_on
    and s.status in ('approved','completed')
  order by s.effective_from desc
  limit 1
$$;

-- ---------- People and history attached to a party ----------
create table public.party_family_members (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  status           public.record_status default 'approved',

  party_id         uuid not null references public.parties(id),
  full_name        text not null,
  relationship_id  uuid references public.relationships(id),
  date_of_birth    date,
  occupation       text,
  mobile           text,
  is_dependent     boolean not null default false,
  is_nominee       boolean not null default false,
  nominee_share_pc numeric(5,2) check (nominee_share_pc >= 0 and nominee_share_pc <= 100)
);
create index party_family_party_idx on public.party_family_members (party_id);

comment on table public.party_family_members is
  'Family, dependants and nominees in one list. A nominee is a family member with the nominee tickbox on and a share percentage -- not a separate table.';

create table public.party_education (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'approved',

  party_id      uuid not null references public.parties(id),
  qualification text not null,
  institution   text,
  board_or_uni  text,
  year_of_pass  int check (year_of_pass between 1950 and 2100),
  grade         text
);
create index party_education_party_idx on public.party_education (party_id);

create table public.party_work_experience (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'approved',

  party_id     uuid not null references public.parties(id),
  company_name text not null,
  designation  text,
  from_date    date,
  to_date      date,
  last_salary  numeric(12,2),
  reason_for_leaving text,
  check (to_date is null or from_date is null or to_date >= from_date)
);
create index party_work_experience_party_idx on public.party_work_experience (party_id);

create table public.employee_assets (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'approved',

  party_id      uuid not null references public.parties(id),
  asset_type    text not null,
  description   text,
  serial_number text,
  issued_on     date not null default current_date,
  returned_on   date,
  check (returned_on is null or returned_on >= issued_on)
);
create index employee_assets_party_idx on public.employee_assets (party_id);

comment on table public.employee_assets is
  'Company property issued to a person. asset_type is free text -- the Tokyo asset_types lookup was empty and was dropped.';

-- ---------- Holidays ----------
create table public.holidays (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  status          public.record_status default 'approved',

  name            text not null,
  holiday_date    date,
  holiday_year    int not null,
  holiday_type_id uuid references public.holiday_types(id),
  branch_id       uuid references public.branches(id),
  is_optional     boolean not null default false,
  remarks         text
);
create index holidays_year_idx on public.holidays (holiday_year, holiday_date);

comment on column public.holidays.holiday_date is
  'Null means the date is not fixed yet -- lunar festivals are added to the year template with the date filled in later.';

select public.attach_conventions('employee_details', true);
select public.attach_conventions('salary_records', true);
select public.attach_conventions('party_family_members');
select public.attach_conventions('party_education');
select public.attach_conventions('party_work_experience');
select public.attach_conventions('employee_assets');
select public.attach_conventions('holidays');
