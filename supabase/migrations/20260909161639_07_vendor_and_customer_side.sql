-- ============================================================
-- 07 VENDOR AND CUSTOMER SIDE
-- Both hang off the same parties row. A vendor's branches are
-- party_addresses, its people are party_contacts, its banks are
-- party_bank_accounts -- the same tables employees use.
-- The Tokyo vendor_categories table was empty and is not recreated.
-- ============================================================

create table public.vendor_details (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  status               public.record_status default 'draft',

  party_id             uuid not null unique references public.parties(id),

  vendor_type          text check (vendor_type in
                         ('material','service','labour','transport','subcontractor','other')),
  payment_terms        text,
  credit_days          int check (credit_days >= 0),
  is_msme              boolean not null default false,
  msme_category        text check (msme_category in ('micro','small','medium')),
  tds_section          text,
  tds_rate             numeric(5,2) check (tds_rate >= 0 and tds_rate <= 100),

  is_blacklisted       boolean not null default false,
  blacklist_reason     text,
  blacklisted_on       date,

  approved_by          uuid references public.parties(id),
  approved_on          timestamptz,
  rejection_reason     text,

  check (not is_blacklisted or blacklist_reason is not null)
);

comment on table public.vendor_details is
  'Vendor-only facts. Branches, contacts and bank accounts are on the shared party tables, so a vendor who is also an employee has one address book, not two.';

create index vendor_details_type_idx on public.vendor_details (vendor_type);

create table public.customer_details (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'draft',

  party_id      uuid not null unique references public.parties(id),

  customer_type text check (customer_type in ('oem','dealer','end_user','government','export','other')),
  credit_limit  numeric(14,2) check (credit_limit >= 0),
  credit_days   int check (credit_days >= 0),
  price_list    text,
  approved_by   uuid references public.parties(id),
  approved_on   timestamptz
);

comment on table public.customer_details is
  'Customer-only facts. Built now, empty for now -- it costs nothing today and saves a rebuild later.';

-- ---------- What we buy, make, store or sell ----------
create table public.items (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  status         public.record_status default 'draft',

  item_number    text unique,
  name           text not null,
  description    text,
  item_type      text not null default 'material'
                   check (item_type in ('raw_material','part','consumable','finished_good','service','asset','material')),
  uom            text not null default 'nos',
  hsn_code       text,
  gst_rate       numeric(5,2) check (gst_rate >= 0 and gst_rate <= 100),
  reorder_level  numeric(14,3) check (reorder_level >= 0),
  is_stocked     boolean not null default true
);
create index items_name_idx on public.items (lower(name));

comment on table public.items is
  'Anything bought, made, stored or sold. Built now so the 360 view works for items the day inventory is added.';

select public.attach_conventions('vendor_details', true);
select public.attach_conventions('customer_details', true);
select public.attach_conventions('items', true);
