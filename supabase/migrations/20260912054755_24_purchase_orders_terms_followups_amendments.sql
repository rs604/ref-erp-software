-- ============================================================
-- 24 PURCHASE, PART 2 — purchase orders and everything on them
--
-- Convention 6 is followed strictly: no total, no received quantity and
-- no billed quantity is stored anywhere here. There is no column to type
-- one into. They are added up from the documents by the views in part 3.
-- ============================================================

create table public.purchase_orders (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  status             public.record_status default 'draft',

  po_number          text unique,
  party_id           uuid not null references public.parties(id),
  branch_address_id  uuid references public.party_addresses(id),
  raised_by_party_id uuid not null references public.parties(id),

  po_date            date not null default current_date,
  promised_delivery_date date not null,
  reference          text not null,
  tracking_level     text not null default 'po' check (tracking_level in ('po','line')),
  first_followup_date date not null,

  is_backdated       boolean not null default false,
  backdate_reason    text,

  is_provisional     boolean not null default false,
  provisional_authorised_by_party_id uuid references public.parties(id),
  provisional_authorised_how text,
  superseded_by_po_id uuid references public.purchase_orders(id),

  is_open_po         boolean not null default false,
  open_po_rate_per_kg numeric(14,4) check (open_po_rate_per_kg > 0),
  open_po_value_limit numeric(14,2) check (open_po_value_limit > 0),
  open_po_valid_until date,

  freight_amount     numeric(14,2) not null default 0 check (freight_amount >= 0),
  freight_gst_rate   numeric(5,2) check (freight_gst_rate between 0 and 100),
  packing_amount     numeric(14,2) not null default 0 check (packing_amount >= 0),
  packing_gst_rate   numeric(5,2) check (packing_gst_rate between 0 and 100),
  loading_amount     numeric(14,2) not null default 0 check (loading_amount >= 0),
  loading_gst_rate   numeric(5,2) check (loading_gst_rate between 0 and 100),

  remarks            text,
  internal_note      text,
  current_revision_no int not null default 0 check (current_revision_no >= 0),
  delivery_slip_count int not null default 0 check (delivery_slip_count >= 0),
  is_hard_copy       boolean not null default false,

  approved_by_party_id uuid references public.parties(id),
  approved_on        timestamptz,

  check (not is_backdated or backdate_reason is not null),
  check (not is_provisional or provisional_authorised_by_party_id is not null),
  check (not is_open_po or (open_po_rate_per_kg is not null and open_po_value_limit is not null)),
  check (po_date <= current_date),
  check (promised_delivery_date >= po_date)
);
comment on table public.purchase_orders is
  'Registered vendors only -- verbal deals happen off-system. No total is stored: line amount, round-off and total are worked out from the lines, never typed.';
comment on column public.purchase_orders.tracking_level is
  'Chosen when the PO is created: track the whole PO, or line by line.';
comment on column public.purchase_orders.is_provisional is
  'A watermarked copy for the genuine short gap, not a two-week absence. It CANNOT receive material -- no challan and no invoice until the real PO is approved, which is enforced by a trigger, not by a screen.';
comment on column public.purchase_orders.freight_amount is
  'Freight, packing and loading are separate footer lines with their own GST and their own spend category. They are never buried inside the item rate.';
comment on column public.purchase_orders.is_open_po is
  'Laser cutting: one open PO per vendor covering all projects, at a fixed rate per kg with a value limit and a validity date. Always owner approval. Warn at 80% of the limit, block at 100%.';
create index purchase_orders_party_idx on public.purchase_orders (party_id, po_date desc);
create index purchase_orders_status_idx on public.purchase_orders (status);
create index purchase_orders_delivery_idx on public.purchase_orders (promised_delivery_date)
  where status in ('submitted','approved');

-- Registered vendors only, and never a blacklisted one.
create or replace function public.check_po_vendor_is_registered()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ok boolean; v_black boolean; v_name text;
begin
  if new.status = 'cancelled' then return new; end if;

  select (vd.status = 'approved'), vd.is_blacklisted, p.display_name
    into v_ok, v_black, v_name
  from public.parties p
  left join public.vendor_details vd on vd.party_id = p.id
  where p.id = new.party_id;

  if v_ok is not true then
    raise exception '% is not a registered vendor yet. A PO can only go to a registered vendor.',
      coalesce(v_name,'This party') using errcode = 'check_violation';
  end if;

  if v_black then
    raise exception '% is blacklisted. Un-blacklist first if this PO is really intended.',
      v_name using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger purchase_orders_vendor_guard
  before insert or update of party_id, status on public.purchase_orders
  for each row execute function public.check_po_vendor_is_registered();
revoke all on function public.check_po_vendor_is_registered() from public, anon, authenticated;

create table public.purchase_order_lines (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'draft',

  po_id         uuid not null references public.purchase_orders(id),
  line_no       int not null check (line_no > 0),
  item_id       uuid not null references public.items(id),
  request_line_id uuid references public.purchase_request_lines(id),
  quotation_line_id uuid references public.quotation_lines(id),

  quantity      numeric(14,3) not null check (quantity > 0),
  rate          numeric(14,4) not null check (rate > 0),
  unit_id       uuid references public.units(id),
  gst_rate      numeric(5,2) not null check (gst_rate between 0 and 100),
  line_amount   numeric(18,4) generated always as (quantity * rate) stored,

  is_estimated  boolean not null default false,
  line_promised_date date,

  last_rate_at_entry numeric(14,4),
  best_rate_at_entry numeric(14,4),
  unique (po_id, line_no)
);
comment on table public.purchase_order_lines is
  'GST rate and unit are copied from the item master and are read-only on the screen. line_amount is worked out by the database -- there is no way to type one.';
comment on column public.purchase_order_lines.is_estimated is
  'Laser cutting: the estimated weight satisfies the PO, but payment is on the actual weight from the vendor''s challan. The line prints as "estimated / approx" and no tolerance rule applies to it.';
comment on column public.purchase_order_lines.last_rate_at_entry is
  'The last purchase rate as it stood when this line was typed, kept so the >3x or <1/3 warning can be explained later. It is a loud warning and never a block.';
create index purchase_order_lines_po_idx on public.purchase_order_lines (po_id);
create index purchase_order_lines_item_idx on public.purchase_order_lines (item_id);

-- ---------- Terms: a library, a copy per PO, a memory per vendor ----------
create table public.standard_terms (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'approved',
  term_key     text not null unique,
  default_text text not null,
  sort_order   int not null default 0
);
comment on table public.standard_terms is
  'The 17 standard terms as they start out. A PO gets its own editable copy in po_terms, so changing the library never rewrites a PO already sent.';

create table public.vendor_default_terms (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  party_id   uuid not null references public.parties(id),
  term_key   text not null references public.standard_terms(term_key),
  term_text  text not null,
  unique (party_id, term_key)
);
comment on table public.vendor_default_terms is
  'Terms remembered per vendor. Steel vendors always get the mill test certificate term, so nobody has to remember to add it.';

create table public.po_terms (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  po_id      uuid not null references public.purchase_orders(id),
  term_key   text not null,
  term_text  text not null,
  sort_order int not null default 0,
  unique (po_id, term_key)
);
comment on table public.po_terms is
  'This PO''s own copy of the terms, editable per PO. Held separately so a PO already sent to a vendor never changes underneath it.';
create index po_terms_po_idx on public.po_terms (po_id);

-- ---------- Technical annexure: revision-tracked, templates per group ----------
create table public.annexure_templates (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',
  name       text not null,
  group_id   uuid references public.item_groups(id),
  body       text not null,
  unique (name, group_id)
);
comment on table public.annexure_templates is
  'A technical annexure saved as a template per item group, so the same specification is not retyped for every steel PO.';

create table public.po_annexures (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  status      public.record_status default 'approved',
  po_id       uuid not null references public.purchase_orders(id),
  revision_no int not null default 0 check (revision_no >= 0),
  body        text not null,
  template_id uuid references public.annexure_templates(id),
  is_current  boolean not null default true,
  unique (po_id, revision_no)
);
comment on table public.po_annexures is
  'Prints as Annexure A. Every revision is kept -- a new row, never an edit -- so what the vendor was actually sent can always be shown.';
create unique index po_annexures_one_current_uidx on public.po_annexures (po_id)
  where is_current and status <> 'cancelled';

-- ---------- The follow-up engine ----------
create table public.po_followups (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  status            public.record_status default 'draft',

  po_id             uuid not null references public.purchase_orders(id),
  due_date          date not null,
  is_pre_delivery_chase boolean not null default false,

  done_at           timestamptz,
  contact_id        uuid references public.party_contacts(id),
  mode              text check (mode in ('phone','whatsapp','email','visit','other')),
  outcome           text check (outcome in ('spoke','no_answer','promised_date','refused','other')),
  what_was_said     text,
  new_promised_date date
);
comment on table public.po_followups is
  'Every follow-up date is created when the PO is created. A date can be PULLED EARLIER but never pushed later, and one chase the day before promised delivery always exists and cannot be removed. All three rules are enforced by triggers here, not by a screen, so the scheduling lifts out cleanly later.';
comment on column public.po_followups.outcome is
  'A "no_answer" is recorded but does NOT count as a follow-up -- three in a row is a signal, not three chases done.';
create index po_followups_po_idx on public.po_followups (po_id, due_date);
create index po_followups_due_idx on public.po_followups (due_date) where done_at is null;
create unique index po_followups_one_pre_delivery_uidx on public.po_followups (po_id)
  where is_pre_delivery_chase and status <> 'cancelled';

create or replace function public.check_followup_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_delivery date;
begin
  select promised_delivery_date into v_delivery
  from public.purchase_orders where id = new.po_id;

  -- A follow-up dated after the delivery date is pointless.
  if new.due_date > v_delivery then
    raise exception 'A follow-up cannot be dated after the promised delivery date of %.', v_delivery
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    -- Pull earlier yes, push later never.
    if new.due_date > old.due_date and old.done_at is null and not old.is_pre_delivery_chase then
      raise exception 'A follow-up can be pulled earlier but never pushed later. It was % and cannot move to %.',
        old.due_date, new.due_date using errcode = 'check_violation';
    end if;

    -- The chase the day before delivery cannot be removed.
    if old.is_pre_delivery_chase and new.status = 'cancelled' then
      raise exception 'The chase the day before promised delivery cannot be removed. It moves with the delivery date instead.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
create trigger po_followups_rules_guard
  before insert or update on public.po_followups
  for each row execute function public.check_followup_rules();
revoke all on function public.check_followup_rules() from public, anon, authenticated;

-- The mandatory chase moves with the delivery date instead of being deleted.
create or replace function public.move_pre_delivery_chase()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.promised_delivery_date is distinct from old.promised_delivery_date then
    update public.po_followups
       set due_date = new.promised_delivery_date - 1
     where po_id = new.id
       and is_pre_delivery_chase
       and done_at is null
       and status <> 'cancelled';
  end if;
  return new;
end;
$$;
create trigger purchase_orders_move_chase
  after update of promised_delivery_date on public.purchase_orders
  for each row execute function public.move_pre_delivery_chase();
revoke all on function public.move_pre_delivery_chase() from public, anon, authenticated;

-- ---------- PO amendments: the only way a bill rate may differ ----------
create table public.po_amendments (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'draft',

  po_id         uuid not null references public.purchase_orders(id),
  po_line_id    uuid not null references public.purchase_order_lines(id),
  revision_no   int not null check (revision_no > 0),
  old_rate      numeric(14,4) not null check (old_rate > 0),
  new_rate      numeric(14,4) not null check (new_rate > 0),
  quantity      numeric(14,3) not null check (quantity > 0),
  difference_amount numeric(18,4) generated always as ((new_rate - old_rate) * quantity) stored,
  approved_by_party_id uuid references public.parties(id),
  approved_on   timestamptz,
  sent_to_vendor_at timestamptz,
  unique (po_line_id, revision_no)
);
comment on table public.po_amendments is
  'Generated when a vendor bills a rate different from the PO rate. The owner sees the rupee difference; approving lets the invoice save and sends the vendor the amended PO. A phone call is not a record -- this is: dated, approved, sent, and held by both sides.';
create index po_amendments_po_idx on public.po_amendments (po_id);

-- ---------- Which approval rules fired, frozen as they were ----------
create table public.po_approvals (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'submitted',

  po_id         uuid not null references public.purchase_orders(id),
  rule_key      text not null,
  rule_snapshot jsonb not null,
  required_approver_role text not null,
  approved_by_party_id uuid references public.parties(id),
  approved_on   timestamptz,
  delegation_id uuid references public.approval_delegations(id),
  decision_note text,
  unique (po_id, rule_key)
);
comment on table public.po_approvals is
  'One row per approval rule that fired on this PO, with the rule copied in as it stood at the time. In-flight POs therefore keep the rule as it was when raised, even if the rule is changed tomorrow.';
create index po_approvals_pending_idx on public.po_approvals (required_approver_role)
  where approved_on is null;

-- Whoever raises a PO cannot approve it, and a delegate cannot approve their own.
create or replace function public.check_approver_is_not_raiser()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_raiser uuid; v_name text;
begin
  if new.approved_by_party_id is null then return new; end if;

  select po.raised_by_party_id, p.display_name into v_raiser, v_name
  from public.purchase_orders po
  join public.parties p on p.id = po.raised_by_party_id
  where po.id = new.po_id;

  if v_raiser = new.approved_by_party_id then
    raise exception '% raised this PO and cannot also approve it.', v_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger po_approvals_approver_guard
  before insert or update of approved_by_party_id on public.po_approvals
  for each row execute function public.check_approver_is_not_raiser();
revoke all on function public.check_approver_is_not_raiser() from public, anon, authenticated;

-- ---------- Every outgoing copy of the PO ----------
create table public.po_dispatches (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  status         public.record_status default 'completed',

  po_id          uuid not null references public.purchase_orders(id),
  revision_no    int not null default 0 check (revision_no >= 0),
  channel        text not null default 'email' check (channel in ('email','hard_copy')),
  to_email       text,
  cc_email       text,
  sent_at        timestamptz,
  delivery_status text check (delivery_status in ('sent','delivered','opened','bounced')),
  bounced_at     timestamptz,
  printed_at     timestamptz,
  printed_by_party_id uuid references public.parties(id),
  changes_stated text
);
comment on table public.po_dispatches is
  'Every outgoing copy of a PO, kept against the PO. Email goes FROM the creator and CCs the approver so replies reach the buyer. A bounce is flagged on the vendor. No email on the vendor means a hard copy, printed, and the print recorded.';
create index po_dispatches_po_idx on public.po_dispatches (po_id, revision_no);
create index po_dispatches_bounced_idx on public.po_dispatches (po_id) where delivery_status = 'bounced';

-- ---------- Conventions and security ----------
select public.attach_conventions('purchase_orders', true);
select public.attach_conventions('purchase_order_lines');
select public.attach_conventions('standard_terms');
select public.attach_conventions('vendor_default_terms');
select public.attach_conventions('po_terms');
select public.attach_conventions('annexure_templates');
select public.attach_conventions('po_annexures');
select public.attach_conventions('po_followups');
select public.attach_conventions('po_amendments', true);
select public.attach_conventions('po_approvals', true);
select public.attach_conventions('po_dispatches');

do $$
declare
  t text;
  spec text[][] := array[
    ['purchase_orders',      'purchase_order.view','purchase_order.create','purchase_order.edit'],
    ['purchase_order_lines', 'purchase_order.view','purchase_order.create','purchase_order.edit'],
    ['standard_terms',       'purchase_order.view','OWNER','OWNER'],
    ['vendor_default_terms', 'purchase_order.view','purchase_order.edit','purchase_order.edit'],
    ['po_terms',             'purchase_order.view','purchase_order.create','purchase_order.edit'],
    ['annexure_templates',   'purchase_order.view','purchase_order.edit','purchase_order.edit'],
    ['po_annexures',         'purchase_order.view','purchase_order.create','purchase_order.edit'],
    ['po_followups',         'purchase_order.view','purchase_order.create','purchase_order.edit'],
    ['po_amendments',        'purchase_order.view','purchase_invoice.create','purchase_order.approve'],
    ['po_approvals',         'purchase_order.view','purchase_order.create','purchase_order.approve'],
    ['po_dispatches',        'purchase_order.view','purchase_order.create','purchase_order.edit']
  ];
  i int;
begin
  for i in 1 .. array_length(spec, 1) loop
    t := spec[i][1];
    execute format('alter table public.%I enable row level security', t);
    execute format($f$
      create policy %I on public.%I for select to authenticated
        using (public.has_permission(%L) or public.is_owner())
    $f$, t || '_read', t, spec[i][2]);

    if spec[i][3] = 'OWNER' then
      execute format($f$
        create policy %I on public.%I for all to authenticated
          using (public.is_owner()) with check (public.is_owner())
      $f$, t || '_write', t);
    else
      execute format($f$
        create policy %I on public.%I for insert to authenticated
          with check (public.has_permission(%L) or public.is_owner())
      $f$, t || '_insert', t, spec[i][3]);
      execute format($f$
        create policy %I on public.%I for update to authenticated
          using (public.has_permission(%L) or public.is_owner())
          with check (public.has_permission(%L) or public.is_owner())
      $f$, t || '_update', t, spec[i][4], spec[i][4]);
    end if;
  end loop;
end $$;

-- ---------- The 17 standard terms (doc 09) ----------
insert into public.standard_terms (term_key, default_text, sort_order) values
  ('freight',                   'Freight: to be borne by the supplier unless stated otherwise.', 1),
  ('loading_unloading',         'Loading and unloading: to the supplier''s account at his works, to our account at our works.', 2),
  ('insurance_transit',         'Transit insurance: to be arranged by the supplier.', 3),
  ('packing_forwarding',        'Packing and forwarding: included in the rate unless shown separately.', 4),
  ('payment_terms',             'Payment: as per the credit days agreed on this order, counted from the invoice date.', 5),
  ('gst',                       'GST: extra as applicable and as shown on this order.', 6),
  ('price_validity',            'Prices are firm for the validity of this order.', 7),
  ('delivery_schedule',         'Delivery: on or before the promised delivery date shown on this order.', 8),
  ('delivery_location',         'Delivery location: our works at Dhandari Kalan, Ludhiana, unless stated otherwise.', 9),
  ('late_delivery',             'Late delivery may lead to cancellation of the balance quantity without further notice.', 10),
  ('material_test_certificate', 'Material test certificate must accompany the material.', 11),
  ('inspection_before_dispatch','We reserve the right to inspect before dispatch.', 12),
  ('rejection',                 'Rejected material must be lifted back at the supplier''s cost within 7 days.', 13),
  ('warranty',                  'Warranty: 12 months from the date of supply.', 14),
  ('po_number_on_documents',    'This PO number must appear on the challan, invoice and all correspondence.', 15),
  ('jurisdiction',              'All disputes are subject to Ludhiana jurisdiction.', 16),
  ('unauthorised_supply',       'Any supply without a valid purchase order will not be accepted or paid for.', 17)
on conflict (term_key) do nothing;
