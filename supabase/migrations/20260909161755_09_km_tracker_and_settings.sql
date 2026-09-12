-- ============================================================
-- 09 KM TRACKER + APP SETTINGS
-- Kept as-is in function, rebuilt on the spine. A daily entry now
-- uses the same status words as everything else:
--   draft      = morning reading in
--   submitted  = evening reading in, cost worked out
--   approved   = checked by admin
--   completed  = paid
--   cancelled  = rejected
-- ============================================================

create table public.vehicles (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  status           public.record_status default 'approved',

  vehicle_number   text not null unique,
  vehicle_name     text not null,
  ownership_type   text not null default 'company'
                     check (ownership_type in ('company','employee')),
  owner_party_id   uuid references public.parties(id),
  rate_per_km      numeric(10,2) check (rate_per_km >= 0),
  make_model       text,
  remarks          text,

  check (ownership_type = 'company' or owner_party_id is not null)
);
create index vehicles_owner_idx on public.vehicles (owner_party_id);

-- who currently drives what
alter table public.employee_details
  add column assigned_vehicle_id uuid references public.vehicles(id);
create index employee_details_vehicle_idx on public.employee_details (assigned_vehicle_id);

create table public.payment_batches (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  status         public.record_status default 'draft',

  document_number text unique,
  party_id       uuid not null references public.parties(id),
  period_from    date not null,
  period_to      date not null,
  paid_on        date,
  paid_by        uuid references public.parties(id),
  remarks        text,
  check (period_to >= period_from)
);
create index payment_batches_party_idx on public.payment_batches (party_id, period_from desc);

create table public.daily_entries (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  status                 public.record_status default 'draft',

  party_id               uuid not null references public.parties(id),
  vehicle_id             uuid not null references public.vehicles(id),
  entry_date             date not null,

  morning_reading        numeric(12,1) check (morning_reading >= 0),
  morning_at             timestamptz,
  morning_location       text,
  morning_lat            numeric(10,7),
  morning_lng            numeric(10,7),
  morning_photo_missing  boolean not null default false,

  evening_reading        numeric(12,1) check (evening_reading >= 0),
  evening_at             timestamptz,
  evening_location       text,
  evening_lat            numeric(10,7),
  evening_lng            numeric(10,7),
  evening_photo_missing  boolean not null default false,

  km_travelled           numeric(10,1) check (km_travelled >= 0),
  rate_applied           numeric(10,2) check (rate_applied >= 0),
  cost                   numeric(12,2) check (cost >= 0),

  approved_by            uuid references public.parties(id),
  approved_on            timestamptz,
  rejection_reason       text,
  payment_batch_id       uuid references public.payment_batches(id),

  unique (party_id, entry_date),
  check (evening_reading is null or morning_reading is null or evening_reading >= morning_reading)
);
create index daily_entries_vehicle_idx on public.daily_entries (vehicle_id, entry_date desc);
create index daily_entries_party_idx   on public.daily_entries (party_id, entry_date desc);
create index daily_entries_batch_idx   on public.daily_entries (payment_batch_id);

comment on table public.daily_entries is
  'One row per driver per day. Photos are rows in attachments with doc_category km_morning_photo and km_evening_photo, so they are virus-scanned and versioned like every other file.';

-- ---------- One row of settings ----------
create table public.app_settings (
  id                        int primary key default 1 check (id = 1),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  status                    public.record_status default 'approved',

  max_daily_km              numeric(10,1) not null default 300,
  session_timeout_minutes   int not null default 480,

  esi_wage_ceiling          numeric(12,2) not null default 21000,
  esi_employee_rate         numeric(6,3) not null default 0.75,
  esi_employer_rate         numeric(6,3) not null default 3.25,
  pf_applicable_company_wide boolean not null default false,
  pf_wage_ceiling           numeric(12,2),
  pf_employee_rate          numeric(6,3),

  payroll_column_widths     jsonb not null default '{}'::jsonb,

  -- file upload rules, enforced in the database and in the upload function
  max_upload_mb             int not null default 25 check (max_upload_mb between 1 and 25),
  allowed_upload_types      text[] not null default array['application/pdf','image/jpeg','image/png'],
  backup_retention_months   int not null default 12 check (backup_retention_months >= 1)
);

comment on table public.app_settings is
  'One row, id = 1. Company-wide switches. Owner only.';

select public.attach_conventions('vehicles');
select public.attach_conventions('payment_batches', true);
select public.attach_conventions('daily_entries', true);
select public.attach_conventions('app_settings');
