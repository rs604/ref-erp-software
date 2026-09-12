-- ============================================================
-- 03 THE PARTY SPINE
-- Rule zero: one list of every person and company. What someone IS to
-- the business -- employee, vendor, customer -- is a role attached to
-- that one entry, never a separate table.
-- ============================================================

create table public.parties (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'draft',

  party_number  text unique,
  party_type    text not null check (party_type in ('person','company')),
  display_name  text not null,
  legal_name    text,

  -- person only
  date_of_birth date,
  gender        text check (gender in ('male','female','other')),
  father_name   text,
  blood_group   text,

  -- statutory identifiers, person or company
  pan           text check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  aadhaar       text check (aadhaar ~ '^[0-9]{12}$'),
  gstin         text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  cin           text,
  msme_number   text,

  primary_mobile text check (primary_mobile ~ '^[6-9][0-9]{9}$'),
  primary_email  text,

  notes         text
);

comment on table public.parties is
  'Every person and every company the business deals with, once. A supervisor who also supplies transport is ONE row here with two roles, which is what makes the 360 view and netting payable against receivable possible.';
comment on column public.parties.party_number is
  'The human number people say out loud, e.g. EMP-0014 or VEN-0031. The uuid stays hidden.';

create unique index parties_pan_uidx     on public.parties (pan)     where pan is not null and status <> 'cancelled';
create unique index parties_aadhaar_uidx on public.parties (aadhaar) where aadhaar is not null and status <> 'cancelled';
create unique index parties_gstin_uidx   on public.parties (gstin)   where gstin is not null and status <> 'cancelled';
create index parties_display_name_idx on public.parties (lower(display_name));

-- ---------- What this party is to us ----------
create table public.party_roles (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',

  party_id   uuid not null references public.parties(id),
  role       text not null check (role in
               ('owner','employee','vendor','customer','contractor','transporter','other')),
  role_from  date not null default current_date,
  role_to    date,
  unique (party_id, role)
);
create index party_roles_party_idx on public.party_roles (party_id);
create index party_roles_role_idx  on public.party_roles (role) where status = 'approved';

comment on table public.party_roles is
  'One row per hat a party wears. A party can wear several at once.';

-- ---------- Shared address book ----------
create table public.party_addresses (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'approved',

  party_id     uuid not null references public.parties(id),
  address_type text not null default 'primary' check (address_type in
                 ('primary','permanent','registered','factory','site','billing','shipping','other')),
  label        text,
  line1        text not null,
  line2        text,
  city_id      uuid references public.cities(id),
  state_id     uuid references public.states(id),
  pincode      text check (pincode ~ '^[1-9][0-9]{5}$'),
  is_primary   boolean not null default false
);
create index party_addresses_party_idx on public.party_addresses (party_id);
create unique index party_addresses_one_primary_uidx
  on public.party_addresses (party_id) where is_primary and status <> 'cancelled';

-- ---------- Shared contact book ----------
create table public.party_contacts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'approved',

  party_id     uuid not null references public.parties(id),
  contact_name text not null,
  designation  text,
  department   text,
  mobile       text check (mobile ~ '^[6-9][0-9]{9}$'),
  alt_mobile   text check (alt_mobile ~ '^[6-9][0-9]{9}$'),
  email        text,
  purpose      text,
  is_primary   boolean not null default false
);
create index party_contacts_party_idx on public.party_contacts (party_id);
create unique index party_contacts_one_primary_uidx
  on public.party_contacts (party_id) where is_primary and status <> 'cancelled';

-- ---------- Shared bank details: one payment run for everyone ----------
create table public.party_bank_accounts (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  status              public.record_status default 'approved',

  party_id            uuid not null references public.parties(id),
  account_holder_name text not null,
  account_number      text not null,
  ifsc                text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name           text,
  branch_name         text,
  account_type        text check (account_type in ('savings','current','cc','od','other')),
  is_primary          boolean not null default false,
  unique (party_id, account_number, ifsc)
);
create index party_bank_accounts_party_idx on public.party_bank_accounts (party_id);
create unique index party_bank_accounts_one_primary_uidx
  on public.party_bank_accounts (party_id) where is_primary and status <> 'cancelled';

comment on table public.party_bank_accounts is
  'Bank details for anyone we pay -- employee salary, vendor bill, contractor labour. One table, one payment run.';

select public.attach_conventions('parties', true);
select public.attach_conventions('party_roles');
select public.attach_conventions('party_addresses');
select public.attach_conventions('party_contacts');
select public.attach_conventions('party_bank_accounts');
