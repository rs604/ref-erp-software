-- ============================================================
-- 23 PURCHASE, PART 1 — the approval engine, requests, quotations
--
-- The approval engine sits in its own tables and its own code, never
-- inside a screen, because the task and FMS engine will lift it out
-- later (doc 12). A rule points at a ROLE, never at a person's name.
-- ============================================================

-- ---------- Numbers people say out loud ----------
insert into public.number_series (series_key, prefix, pad_width, include_year, description) values
  ('purchase_request','PR',4,true,'Purchase request'),
  ('quotation','QT',4,true,'Vendor quotation'),
  ('purchase_order','PO',4,true,'Purchase order'),
  ('goods_receipt','GRN',4,true,'Inward challan / goods receipt'),
  ('purchase_invoice','PINV',4,true,'Internal reference for a vendor bill'),
  ('purchase_return','RET',4,true,'Return to vendor'),
  ('debit_note','DN',4,true,'Debit note against a billed return'),
  ('vendor_payment','PAY',4,true,'Payment to a vendor'),
  ('vendor_advance','VA',4,true,'Advance paid against a PO'),
  ('drawing_sent','DWG',4,true,'Laser cutting drawing sent to a vendor')
on conflict (series_key) do nothing;

-- ---------- Permissions for the whole purchase module ----------
insert into public.permissions (key, sub_head, action, label, category) values
  ('purchase_request.view',  'purchase_request','view',  'View Purchase Requests','Inventory & Purchase'),
  ('purchase_request.create','purchase_request','create','Raise a Purchase Request','Inventory & Purchase'),
  ('purchase_request.edit',  'purchase_request','edit',  'Edit Purchase Requests','Inventory & Purchase'),
  ('purchase_request.cancel','purchase_request','cancel','Cancel a Purchase Request','Inventory & Purchase'),
  ('quotation.view',   'quotation','view',  'View Quotations','Inventory & Purchase'),
  ('quotation.create', 'quotation','create','Enter Quotations','Inventory & Purchase'),
  ('quotation.edit',   'quotation','edit',  'Edit Quotations','Inventory & Purchase'),
  ('purchase_order.view',   'purchase_order','view',   'View Purchase Orders','Inventory & Purchase'),
  ('purchase_order.create', 'purchase_order','create', 'Raise Purchase Orders','Inventory & Purchase'),
  ('purchase_order.edit',   'purchase_order','edit',   'Edit Purchase Orders','Inventory & Purchase'),
  ('purchase_order.approve','purchase_order','approve','Approve Purchase Orders','Inventory & Purchase'),
  ('goods_receipt.view',  'goods_receipt','view',  'View Inward Challans','Inventory & Purchase'),
  ('goods_receipt.create','goods_receipt','create','Record Inward Challans','Inventory & Purchase'),
  ('purchase_invoice.view',  'purchase_invoice','view',  'View Vendor Bills','Inventory & Purchase'),
  ('purchase_invoice.create','purchase_invoice','create','Enter Vendor Bills','Inventory & Purchase'),
  ('purchase_invoice.edit',  'purchase_invoice','edit',  'Edit Vendor Bills','Inventory & Purchase'),
  ('purchase_return.view',  'purchase_return','view',  'View Returns','Inventory & Purchase'),
  ('purchase_return.create','purchase_return','create','Record Returns','Inventory & Purchase'),
  ('short_close.approve','short_close','approve','Approve Short Closes','Inventory & Purchase'),
  ('vendor_payment.view',   'vendor_payment','view',   'View Vendor Payments','Inventory & Purchase'),
  ('vendor_payment.create', 'vendor_payment','create', 'Record Vendor Payments','Inventory & Purchase'),
  ('vendor_payment.approve','vendor_payment','approve','Approve Vendor Payments','Inventory & Purchase'),
  ('laser_drawing.view',  'laser_drawing','view',  'View Drawings Sent','Inventory & Purchase'),
  ('laser_drawing.create','laser_drawing','create','Send Drawings','Inventory & Purchase')
on conflict (key) do nothing;

-- ============================================================
-- THE APPROVAL ENGINE — its own tables, liftable later
-- ============================================================

-- The six rules from doc 09. A rule names a role, never a person.
-- Roles map onto what someone is allowed to do:
--   purchaser        holds purchase_order.create
--   purchase_manager holds purchase_order.approve
--   owner            is_owner()
create table public.approval_rules (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  status         public.record_status default 'approved',

  rule_key       text not null check (rule_key in (
                   'rate_above_last_purchase',
                   'new_vendor_first_po',
                   'value_above_role_limit',
                   'item_never_purchased',
                   'backdated_po',
                   'qty_above_item_max')),
  raiser_role    text check (raiser_role in ('purchaser','purchase_manager','owner')),
  limit_amount   numeric(14,2) check (limit_amount >= 0),
  approver_role  text not null check (approver_role in ('purchase_manager','owner')),
  is_active      boolean not null default true,
  can_be_disabled boolean not null default true,
  effective_from date not null default current_date,
  note           text,
  unique (rule_key, raiser_role),
  -- Doc 09: the backdated-PO rule is always on and cannot be switched off.
  check (can_be_disabled or is_active)
);
comment on table public.approval_rules is
  'Approval by exception. Six rules, each pointing at a role. Kept in its own table so the task and FMS engine can lift the whole thing out without touching a purchase screen.';
comment on column public.approval_rules.can_be_disabled is
  'False for the backdated-PO rule only. The check constraint then makes is_active = false impossible, so nobody can quietly turn it off.';

create table public.approval_delegations (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  status                public.record_status default 'approved',

  delegate_party_id     uuid not null references public.parties(id),
  delegated_by_party_id uuid not null references public.parties(id),
  limit_amount          numeric(14,2) not null check (limit_amount > 0),
  valid_from            date not null default current_date,
  valid_to              date not null,
  reason                text,
  check (valid_to >= valid_from),
  check (delegate_party_id <> delegated_by_party_id)
);
comment on table public.approval_delegations is
  'Name a person, set a limit, set a date range. It ends by itself on valid_to -- there is no permanent access to forget about. The delegate still cannot approve their own PO.';
create index approval_delegations_window_idx
  on public.approval_delegations (delegate_party_id, valid_from, valid_to)
  where status = 'approved';

-- ============================================================
-- PURCHASE REQUESTS — anyone may raise one, no approval to ask
-- ============================================================
create table public.purchase_requests (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  status            public.record_status default 'draft',

  request_number    text unique,
  source            text not null default 'manual'
                      check (source in ('manual','project','system_reorder')),
  project_ref       text,
  raised_by_party_id uuid not null references public.parties(id),
  urgency           text not null default 'normal'
                      check (urgency in ('breakdown','urgent','normal')),
  needed_by         date,
  required_for      text,

  respond_by        timestamptz,
  manager_pinged_at timestamptz,
  owner_escalated_at timestamptz,

  cancelled_by_party_id uuid references public.parties(id),
  cancel_reason     text,
  rejection_requested_by uuid references public.parties(id),
  rejection_reason  text
);
comment on table public.purchase_requests is
  'Anyone may raise one and nobody approves it -- asking costs nothing, buying is what needs approval. The purchase manager cannot reject a request; only the raiser may cancel their own, or the owner. The manager raises a rejection request instead, and the raiser is always told why.';
comment on column public.purchase_requests.urgency is
  'Response time, NOT delivery time. Breakdown = purchase starts within 4 hours and the manager''s phone is pinged. Urgent = same day. Normal = the needed-by date governs. When material arrives is the vendor''s constraint and cannot be fairly measured.';
comment on column public.purchase_requests.respond_by is
  'When purchase must have STARTED, worked out from the urgency. Breakdown is 4 hours; the owner is pinged if nobody acts within an hour of that.';
create index purchase_requests_urgency_idx on public.purchase_requests (urgency, needed_by)
  where status in ('draft','submitted','approved');
create index purchase_requests_raiser_idx on public.purchase_requests (raised_by_party_id);

create table public.purchase_request_lines (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  status             public.record_status default 'draft',

  request_id         uuid not null references public.purchase_requests(id),
  line_no            int not null check (line_no > 0),
  item_id            uuid references public.items(id),
  free_text          text,
  suggested_item_id  uuid references public.items(id),
  suggestion_answered boolean not null default false,
  quantity           numeric(14,3) not null check (quantity > 0),
  unit_id            uuid references public.units(id),
  po_deadline        date,
  free_stock_at_raise numeric(14,3),
  merged_into_line_id uuid references public.purchase_request_lines(id),
  unique (request_id, line_no),
  -- Item search first, free text only as a deliberate last choice.
  check (item_id is not null or free_text is not null)
);
comment on table public.purchase_request_lines is
  'A line names an item, or says the words in free text as a deliberate last choice. Free text shows amber to the purchaser with "pick the item".';
comment on column public.purchase_request_lines.suggested_item_id is
  'The "did you mean...?" match. The raiser is asked once, the answer is remembered, and free text almost disappears over months.';
comment on column public.purchase_request_lines.free_stock_at_raise is
  'FREE stock, not physical stock -- 120 bearings with 100 locked to a job is 20 free. Snapshotted here so the queue can show it without recomputing history.';
comment on column public.purchase_request_lines.po_deadline is
  'The date the PO must be issued by. It comes from the item, not from one global setting.';
create index purchase_request_lines_request_idx on public.purchase_request_lines (request_id);
create index purchase_request_lines_item_idx on public.purchase_request_lines (item_id);

-- ============================================================
-- QUOTATIONS — unregistered vendors may quote
-- ============================================================
create table public.quotations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  status           public.record_status default 'draft',

  quotation_number text unique,
  request_id       uuid references public.purchase_requests(id),
  party_id         uuid not null references public.parties(id),
  quotation_date   date not null default current_date,
  valid_until      date,
  delivery_days    int check (delivery_days >= 0),
  freight_amount   numeric(14,2) not null default 0 check (freight_amount >= 0),
  other_charges    numeric(14,2) not null default 0 check (other_charges >= 0),
  remarks          text,
  unique (request_id, party_id)
);
comment on table public.quotations is
  'Registration blocks POs, not enquiries -- an unregistered vendor may quote, which is why this points at parties and not at vendor_details. Losing quotes are kept: they are the only price history for items never bought.';
create index quotations_party_idx on public.quotations (party_id);
create index quotations_request_idx on public.quotations (request_id);

-- Doc 09: max 4 vendors on a comparison.
create or replace function public.check_max_four_quotations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  if new.request_id is null or new.status = 'cancelled' then
    return new;
  end if;

  select count(distinct party_id) into v_count
  from public.quotations
  where request_id = new.request_id
    and status <> 'cancelled'
    and id <> new.id;

  if v_count >= 4 then
    raise exception 'This request already has quotations from 4 vendors. The comparison holds 4 at a time.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger quotations_max_four_guard
  before insert or update of request_id, party_id, status on public.quotations
  for each row execute function public.check_max_four_quotations();
revoke all on function public.check_max_four_quotations() from public, anon, authenticated;

create table public.quotation_lines (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  status         public.record_status default 'draft',

  quotation_id   uuid not null references public.quotations(id),
  line_no        int not null check (line_no > 0),
  item_id        uuid not null references public.items(id),
  quantity       numeric(14,3) not null check (quantity > 0),
  rate           numeric(14,4) check (rate > 0),
  freight_per_unit numeric(14,4) not null default 0 check (freight_per_unit >= 0),
  landed_rate    numeric(14,4) generated always as
                   (coalesce(rate, 0) + freight_per_unit) stored,
  delivery_days  int check (delivery_days >= 0),
  is_recommended boolean not null default false,
  override_reason text,
  overridden_by_party_id uuid references public.parties(id),
  unique (quotation_id, line_no)
);
comment on table public.quotation_lines is
  'One row per item per vendor. Rate is left NULL when the vendor did not quote -- blank means not quoted, and it is never entered as zero.';
comment on column public.quotation_lines.landed_rate is
  'Rate plus freight, worked out by the database and never typed. A cheaper rate with freight on top can lose, which is the whole reason landed cost is shown beside every rate.';
comment on column public.quotation_lines.is_recommended is
  'The recommendation is per ITEM, on landed cost inside the required-by date. Split orders across vendors are normal, not an exception.';
create index quotation_lines_quotation_idx on public.quotation_lines (quotation_id);
create index quotation_lines_item_idx on public.quotation_lines (item_id);

-- ---------- Conventions and security ----------
select public.attach_conventions('approval_rules');
select public.attach_conventions('approval_delegations');
select public.attach_conventions('purchase_requests', true);
select public.attach_conventions('purchase_request_lines');
select public.attach_conventions('quotations', true);
select public.attach_conventions('quotation_lines');

do $$
declare
  t text;
  spec text[][] := array[
    ['approval_rules',        'purchase_order.view',   'OWNER',                 'OWNER'],
    ['approval_delegations',  'purchase_order.view',   'OWNER',                 'OWNER'],
    ['purchase_requests',     'purchase_request.view', 'purchase_request.create','purchase_request.edit'],
    ['purchase_request_lines','purchase_request.view', 'purchase_request.create','purchase_request.edit'],
    ['quotations',            'quotation.view',        'quotation.create',      'quotation.edit'],
    ['quotation_lines',       'quotation.view',        'quotation.create',      'quotation.edit']
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
          with check (public.has_permission(%L))
      $f$, t || '_insert', t, spec[i][3]);
      execute format($f$
        create policy %I on public.%I for update to authenticated
          using (public.has_permission(%L) or public.is_owner())
          with check (public.has_permission(%L) or public.is_owner())
      $f$, t || '_update', t, spec[i][4], spec[i][4]);
    end if;
  end loop;
end $$;

-- ---------- Seed the six rules (doc 09) ----------
insert into public.approval_rules
  (rule_key, raiser_role, limit_amount, approver_role, is_active, can_be_disabled, note) values
  ('rate_above_last_purchase', null,               null, 'purchase_manager', true, true,
   'Rate higher than the last purchase rate for this item.'),
  ('new_vendor_first_po',      null,               null, 'owner',            true, true,
   'The first PO ever raised on a vendor.'),
  ('value_above_role_limit',  'purchaser',        10000, 'purchase_manager', true, true,
   'A purchaser may commit up to Rs 10,000 without asking.'),
  ('value_above_role_limit',  'purchase_manager', 50000, 'owner',            true, true,
   'A purchase manager may commit up to Rs 50,000. Above that it is the owner.'),
  ('item_never_purchased',     null,               null, 'purchase_manager', true, true,
   'This item has never been bought before.'),
  ('backdated_po',             null,               null, 'owner',            true, false,
   'A PO dated earlier than today. Always on, cannot be switched off, owner only.'),
  ('qty_above_item_max',       null,               null, 'purchase_manager', true, true,
   'Quantity above the item''s maximum order quantity.')
on conflict (rule_key, raiser_role) do nothing;
