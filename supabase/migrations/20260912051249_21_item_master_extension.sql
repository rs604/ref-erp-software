-- ============================================================
-- 21 ITEM MASTER — THE LOCKED DESIGN (doc 10)
--
-- Extends the existing items table. Nothing is rebuilt and no column
-- is dropped. items had 0 rows when this ran, so every tightened rule
-- costs nothing today and prevents a cleanup project later.
--
-- The four axes are kept apart on purpose (doc 10):
--   item type  - what happens to the thing
--   group      - which questions the form asks
--   source     - how it came to exist
--   can be sold- yes or no
-- Collapsing any two of them is the mistake that kills an item master.
-- ============================================================

-- ---------- Units: Masters > Units in the nav ----------
create table public.units (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null unique,
  symbol     text
);
comment on table public.units is
  'One unit per item, and changing an item''s unit needs approval. A separate list so "Kg" is spelled one way everywhere.';

-- ---------- Category: which report the money lands in ----------
create table public.item_categories (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null unique,
  spend_type text not null default 'revenue' check (spend_type in ('capital','revenue')),
  sort_order int  not null default 0
);
comment on table public.item_categories is
  'Category decides which report the money lands in. It is NOT the group and NOT the item type -- doc 10 keeps all three apart.';
comment on column public.item_categories.spend_type is
  'Capital or revenue. The default for the category; an item can override it, because machinery inside Tools is capital while the rest of Tools is not. The purchase team never sees this tag.';

-- ---------- Group: which questions the form asks ----------
create table public.item_groups (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid,
  status                    public.record_status default 'approved',
  name                      text not null unique,
  category_id               uuid not null references public.item_categories(id),
  default_qty_above_pct     numeric(6,3) not null default 0 check (default_qty_above_pct >= 0),
  default_qty_below_pct     numeric(6,3) not null default 0 check (default_qty_below_pct >= 0)
);
comment on table public.item_groups is
  'A group is a set of items the form would ask the same questions about. Never group by which machine the part goes into -- a gear box is a gear box.';
comment on column public.item_groups.default_qty_above_pct is
  'Seeds the item''s own tolerance. Steel is cut to standard lengths so 5,000 Kg can arrive as 5,100; bearings have zero tolerance.';
create index item_groups_category_idx on public.item_groups (category_id);

-- ---------- Sub-group: carries the name pattern ----------
create table public.item_sub_groups (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'approved',
  name         text not null,
  group_id     uuid not null references public.item_groups(id),
  name_pattern text,
  unique (group_id, name)
);
comment on table public.item_sub_groups is
  'Sub-group, not group, carries the name pattern. Electricals is too broad -- an MCB has poles, a relay has pins.';
comment on column public.item_sub_groups.name_pattern is
  'Shown above the name box as a reminder of the order, e.g. "Item - Ampere - Poles - Make". Typing out of order warns, it never blocks.';
create index item_sub_groups_group_idx on public.item_sub_groups (group_id);

-- ---------- HSN: the GST rate is suggested from here ----------
create table public.hsn_codes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  status      public.record_status default 'approved',
  code        text not null unique check (code ~ '^[0-9]{4,8}$'),
  gst_rate    numeric(5,2) not null check (gst_rate in (0, 5, 18, 40)),
  description text
);
comment on table public.hsn_codes is
  'GST is suggested from the HSN, corrected once, and the correction is remembered here so the next item with the same HSN gets it right. Slabs are 0, 5, 18 and 40 -- 12 and 28 were abolished on 22 Sep 2025.';

-- ---------- The item itself: extend, never rebuild ----------
-- The seven item types are locked in doc 10. The old list had 'part',
-- 'finished_good' and a catch-all 'material' default that would have let
-- every item be created without anyone deciding what it is.
alter table public.items drop constraint if exists items_item_type_check;
alter table public.items alter column item_type drop default;
alter table public.items
  add constraint items_item_type_check check (item_type in
    ('raw_material','component','semi_finished','finished_goods',
     'consumable','asset','service'));

alter table public.items
  add column unit_id                uuid references public.units(id),
  add column group_id               uuid references public.item_groups(id),
  add column sub_group_id           uuid references public.item_sub_groups(id),
  add column source                 text check (source in ('bought_out','made_in_house','job_work')),
  add column can_be_sold            boolean not null default false,
  add column sales_name             text,
  add column made_for_item_id       uuid references public.items(id),
  add column max_order_qty          numeric(14,3) check (max_order_qty > 0),
  add column qty_above_acceptable_pct numeric(6,3) check (qty_above_acceptable_pct >= 0),
  add column qty_below_acceptable_pct numeric(6,3) check (qty_below_acceptable_pct >= 0),
  add column spend_type_override    text check (spend_type_override in ('capital','revenue')),
  add column remarks                text,
  add column approved_by            uuid references public.parties(id),
  add column approved_on            timestamptz;

comment on column public.items.made_for_item_id is
  'The one machine this is made for, and only for made-in-house or job-work items. Bought-out common parts are deliberately untagged -- a bearing fits conveyors, lifts and hoists, so any tag on it would be false. Answers 80-90% of machine-wise reporting, which was accepted explicitly.';
comment on column public.items.sales_name is
  'Bought-out and trading items only, so a customer cannot price-match online. Blank for anything made in-house -- nobody can google a head pulley you fabricated. Blank is normal, not an error.';
comment on column public.items.qty_above_acceptable_pct is
  'Mandatory on every item. Zero is a valid answer and must be typed, because blank is ambiguous -- nobody knows later whether it meant zero or nobody thought about it.';
comment on column public.items.spend_type_override is
  'Set only where the item disagrees with its category, e.g. machinery inside Tools is capital. Null means take the category''s answer.';
comment on column public.items.uom is
  'DEPRECATED by unit_id. Left in place because dropping a column needs the owner''s approval. Do not write to it.';

-- Sales name belongs only to things we buy and resell.
alter table public.items add constraint items_sales_name_bought_out_only
  check (sales_name is null or source = 'bought_out');

-- "Made for" belongs only to things we make.
alter table public.items add constraint items_made_for_only_when_made
  check (made_for_item_id is null or source in ('made_in_house','job_work'));

create index items_group_idx      on public.items (group_id);
create index items_sub_group_idx  on public.items (sub_group_id);
create index items_hsn_idx        on public.items (hsn_code);
create index items_made_for_idx   on public.items (made_for_item_id) where made_for_item_id is not null;
create index items_can_be_sold_idx on public.items (can_be_sold) where can_be_sold;

-- ---------- Minimum selling price: dated, never overwritten ----------
create table public.item_selling_prices (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  status            public.record_status default 'approved',
  item_id           uuid not null references public.items(id),
  min_selling_price numeric(14,2) not null check (min_selling_price >= 0),
  effective_from    date not null default current_date,
  reason            text,
  unique (item_id, effective_from)
);
comment on table public.item_selling_prices is
  'A minimum selling price is never overwritten -- a new row with a new effective-from date. Selling below it warns and never blocks; the sale continues and reaches the owner with a mandatory reason.';
create index item_selling_prices_item_idx on public.item_selling_prices (item_id, effective_from desc);

-- ---------- The HSN length rule is a setting, not code ----------
alter table public.app_settings
  add column hsn_min_digits int not null default 4 check (hsn_min_digits in (4,6,8));
comment on column public.app_settings.hsn_min_digits is
  'How many HSN digits this firm must quote. 4 is correct below Rs 5 crore turnover. A shorter HSN shows red everywhere and blocks the PO, so the items actually used get fixed first and no cleanup project is ever needed.';

-- ---------- Item numbers: a plain running number from 5000000 ----------
-- Item codes never leave the building, so they carry no prefix. PO and
-- vendor numbers do appear on printed documents, so they keep theirs.
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

  -- An empty prefix means a bare running number, with no leading dash.
  return case when s.prefix = '' then '' else s.prefix || '-' end
       || case when s.include_year then to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' else '' end
       || lpad(v_n::text, s.pad_width, '0');
end;
$$;

update public.number_series
   set prefix = '', pad_width = 7, next_number = 5000000, include_year = false,
       description = 'Plain running number from 5000000. No prefix, no meaning. Item codes never leave the building.'
 where series_key = 'item';

-- Doc 11 locks the vendor code as V-0042, not VEN-0042.
update public.number_series set prefix = 'V' where series_key = 'vendor';

-- ---------- Permissions for the item master ----------
insert into public.permissions (key, sub_head, action, label, category) values
  ('item_master.view',    'item_master', 'view',    'View Item Master',  'Masters'),
  ('item_master.create',  'item_master', 'create',  'Create Items',      'Masters'),
  ('item_master.edit',    'item_master', 'edit',    'Edit Items',        'Masters'),
  ('item_master.approve', 'item_master', 'approve', 'Approve Items',     'Masters')
on conflict (key) do nothing;

-- ---------- Conventions and security on everything new ----------
select public.attach_conventions('units');
select public.attach_conventions('item_categories');
select public.attach_conventions('item_groups');
select public.attach_conventions('item_sub_groups');
select public.attach_conventions('hsn_codes');
select public.attach_conventions('item_selling_prices', true);

do $$
declare t text;
begin
  foreach t in array array[
    'units','item_categories','item_groups','item_sub_groups','hsn_codes','item_selling_prices'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format($f$
      create policy %I on public.%I for select to authenticated
        using (public.current_party_id() is not null)
    $f$, t || '_read', t);

    execute format($f$
      create policy %I on public.%I for insert to authenticated
        with check (public.has_permission('item_master.create')
                 or public.has_permission('item_master.edit'))
    $f$, t || '_insert', t);

    execute format($f$
      create policy %I on public.%I for update to authenticated
        using (public.has_permission('item_master.edit')
            or public.has_permission('item_master.approve'))
        with check (public.has_permission('item_master.edit')
                 or public.has_permission('item_master.approve'))
    $f$, t || '_update', t);
  end loop;
end $$;

-- items itself was owner-only to write. Postgres ORs permissive policies
-- together, so these ADD permission-holders without touching the existing
-- owner rule and without reducing the policy count.
create policy items_insert_perm on public.items for insert to authenticated
  with check (public.has_permission('item_master.create'));
create policy items_update_perm on public.items for update to authenticated
  using (public.has_permission('item_master.edit')
      or public.has_permission('item_master.approve'))
  with check (public.has_permission('item_master.edit')
           or public.has_permission('item_master.approve'));

-- ---------- Seed the ten categories (doc 10) ----------
insert into public.item_categories (name, spend_type, sort_order) values
  ('Steel & Metals',       'revenue',  1),
  ('Transmission',         'revenue',  2),
  ('Electricals',          'revenue',  3),
  ('Hardware & Fasteners', 'revenue',  4),
  ('Machine Parts',        'revenue',  5),
  ('Tools',                'revenue',  6),
  ('Consumables',          'revenue',  7),
  ('Job Work',             'revenue',  8),
  ('Overheads',            'revenue',  9),
  ('Office & IT',          'capital', 10)
on conflict (name) do nothing;

-- ---------- Seed the units actually used here ----------
insert into public.units (name, symbol) values
  ('Numbers','Nos'), ('Kilogram','Kg'), ('Metre','Mtr'), ('Feet','Ft'),
  ('Litre','Ltr'), ('Set','Set'), ('Pair','Pair'), ('Box','Box'),
  ('Roll','Roll'), ('Square Feet','Sq Ft'), ('Hour','Hr'), ('Job','Job'),
  ('Tonne','Ton'), ('Bundle','Bdl'), ('Packet','Pkt')
on conflict (name) do nothing;
