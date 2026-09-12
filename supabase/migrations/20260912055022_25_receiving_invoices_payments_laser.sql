-- ============================================================
-- 25 PURCHASE, PART 3 — receiving, bills, returns, payments, laser
--
-- The rule this part exists to get right (doc 09):
--   The bill rate must EQUAL the PO rate. There is no override and no
--   reason box. When the vendor bills differently the invoice line
--   SPLITS by quantity and rate, and each differing piece must point at
--   a PO amendment. The invoice cannot be approved until the owner has
--   approved that amendment. Enforced by triggers, so no screen can
--   ever be written the old amber-and-continue way.
-- ============================================================

-- ---------- Challan in. No photo needed. ----------
create table public.goods_receipts (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  status         public.record_status default 'draft',

  grn_number     text unique,
  po_id          uuid not null references public.purchase_orders(id),
  party_id       uuid not null references public.parties(id),
  challan_number text not null,
  challan_date   date not null,
  received_on    date not null default current_date,
  vehicle_number text,
  remarks        text,
  unique (party_id, challan_number, challan_date)
);
comment on table public.goods_receipts is
  'The challan step. Number, date and quantity per line -- no photo needed. Receipt state on the PO moves, but NOTHING enters the payment list yet: a challan is not a bill.';
create index goods_receipts_po_idx on public.goods_receipts (po_id);

-- A provisional PO cannot receive material. Enforced here, not on a screen.
create or replace function public.check_po_can_receive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_prov boolean; v_status text; v_num text;
begin
  if new.status = 'cancelled' then return new; end if;

  select is_provisional, status, po_number into v_prov, v_status, v_num
  from public.purchase_orders where id = new.po_id;

  if v_prov then
    raise exception 'PO % is a provisional copy. It cannot receive material -- no challan and no invoice until the real PO is approved.', v_num
      using errcode = 'check_violation';
  end if;

  if v_status not in ('approved','completed') then
    raise exception 'PO % is not approved yet, so material cannot be booked against it.', v_num
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger goods_receipts_can_receive_guard
  before insert or update of po_id, status on public.goods_receipts
  for each row execute function public.check_po_can_receive();
revoke all on function public.check_po_can_receive() from public, anon, authenticated;

create table public.goods_receipt_lines (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'draft',

  grn_id        uuid not null references public.goods_receipts(id),
  po_line_id    uuid not null references public.purchase_order_lines(id),
  item_id       uuid not null references public.items(id),
  received_qty  numeric(14,3) not null check (received_qty > 0),
  actual_weight_kg numeric(14,3) check (actual_weight_kg > 0),
  tolerance_override_by_party_id uuid references public.parties(id),
  tolerance_override_reason text,
  remarks       text,
  unique (grn_id, po_line_id)
);
comment on table public.goods_receipt_lines is
  'Quantity received against a PO line. Outside the item''s acceptable percentage the row is blocked until the owner overrides it. Under tolerance the PO line simply stays open and follow-ups continue.';
comment on column public.goods_receipt_lines.actual_weight_kg is
  'Laser cutting is paid by ACTUAL weight from the vendor''s challan, not by the estimate that satisfied the PO.';
create index goods_receipt_lines_grn_idx on public.goods_receipt_lines (grn_id);
create index goods_receipt_lines_po_line_idx on public.goods_receipt_lines (po_line_id);

create or replace function public.check_receipt_within_tolerance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ordered numeric; v_above numeric; v_est boolean; v_total numeric; v_name text;
begin
  if new.status = 'cancelled' then return new; end if;

  select l.quantity, coalesce(i.qty_above_acceptable_pct, 0), l.is_estimated, i.name
    into v_ordered, v_above, v_est, v_name
  from public.purchase_order_lines l
  join public.items i on i.id = l.item_id
  where l.id = new.po_line_id;

  -- No tolerance rule applies to an estimated (laser) line.
  if v_est then return new; end if;

  select coalesce(sum(received_qty), 0) into v_total
  from public.goods_receipt_lines
  where po_line_id = new.po_line_id and status <> 'cancelled' and id <> new.id;

  v_total := v_total + new.received_qty;

  if v_total > v_ordered * (1 + v_above / 100.0)
     and new.tolerance_override_by_party_id is null then
    raise exception '% ordered %, this challan takes the total to %. That is above the acceptable %% for this item, so it needs the owner to accept it.',
      v_name, v_ordered, v_total using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger goods_receipt_lines_tolerance_guard
  before insert or update on public.goods_receipt_lines
  for each row execute function public.check_receipt_within_tolerance();
revoke all on function public.check_receipt_within_tolerance() from public, anon, authenticated;

-- ---------- The vendor's bill ----------
create table public.purchase_invoices (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  status          public.record_status default 'draft',

  internal_number text unique,
  invoice_number  text not null,
  po_id           uuid not null references public.purchase_orders(id),
  party_id        uuid not null references public.parties(id),
  invoice_date    date not null,

  financial_year  int generated always as
                    ((extract(year from invoice_date))::int
                     - case when (extract(month from invoice_date))::int >= 4 then 0 else 1 end) stored,

  taxable_amount  numeric(14,2) not null check (taxable_amount >= 0),
  cgst_amount     numeric(14,2) not null default 0 check (cgst_amount >= 0),
  sgst_amount     numeric(14,2) not null default 0 check (sgst_amount >= 0),
  igst_amount     numeric(14,2) not null default 0 check (igst_amount >= 0),
  round_off       numeric(8,2)  not null default 0,
  total_amount    numeric(14,2) not null check (total_amount >= 0),

  unlocked_by_party_id uuid references public.parties(id),
  unlock_reason   text,
  remarks         text,

  -- Vendors legally restart their invoice series every financial year,
  -- so the same number in a different year is a different bill.
  unique (party_id, invoice_number, financial_year),

  -- Punjab is CGST + SGST, outside Punjab is IGST. Never both.
  check (not ((cgst_amount > 0 or sgst_amount > 0) and igst_amount > 0)),

  -- What was typed must add up, or it is blocked with the difference.
  check (abs(taxable_amount + cgst_amount + sgst_amount + igst_amount + round_off - total_amount) < 0.01)
);
comment on table public.purchase_invoices is
  'No PO, no invoice -- a genuine unordered purchase needs a backdated PO first. The duplicate check is vendor + invoice number + FINANCIAL YEAR, worked out from the invoice date and never typed.';
comment on column public.purchase_invoices.financial_year is
  'The Indian financial year of the invoice date: April to March. 2026 means 2026-27. Worked out by the database so nobody can type the wrong year and defeat the duplicate check.';
comment on column public.purchase_invoices.unlocked_by_party_id is
  'A fully billed PO is blocked. The owner may unlock it for one more invoice, with a reason, and that is recorded here.';
create index purchase_invoices_po_idx on public.purchase_invoices (po_id);
create index purchase_invoices_party_idx on public.purchase_invoices (party_id, invoice_date desc);

create or replace function public.check_invoice_dates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_po_date date; v_num text; v_prov boolean;
begin
  if new.status = 'cancelled' then return new; end if;

  select po_date, po_number, is_provisional into v_po_date, v_num, v_prov
  from public.purchase_orders where id = new.po_id;

  if v_prov then
    raise exception 'PO % is a provisional copy. No invoice can be entered against it until the real PO is approved.', v_num
      using errcode = 'check_violation';
  end if;

  if new.invoice_date > current_date then
    raise exception 'The invoice date cannot be in the future.' using errcode = 'check_violation';
  end if;

  if new.invoice_date < v_po_date then
    raise exception 'This invoice is dated % but PO % is dated %. A bill cannot be older than the order it is against.',
      new.invoice_date, v_num, v_po_date using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger purchase_invoices_dates_guard
  before insert or update of invoice_date, po_id, status on public.purchase_invoices
  for each row execute function public.check_invoice_dates();
revoke all on function public.check_invoice_dates() from public, anon, authenticated;

create table public.purchase_invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'draft',

  invoice_id   uuid not null references public.purchase_invoices(id),
  line_no      int not null check (line_no > 0),
  po_line_id   uuid not null references public.purchase_order_lines(id),
  item_id      uuid not null references public.items(id),
  quantity     numeric(14,3) not null check (quantity > 0),
  rate         numeric(14,4) not null check (rate > 0),
  gst_rate     numeric(5,2) not null check (gst_rate between 0 and 100),
  line_amount  numeric(18,4) generated always as (quantity * rate) stored,
  amendment_id uuid references public.po_amendments(id),
  unique (invoice_id, line_no)
);
comment on table public.purchase_invoice_lines is
  'When the vendor bills a rate other than the PO rate, the line SPLITS by quantity and rate -- 250 at 64 and 250 at 66.50 -- and each piece that differs must point at a PO amendment. There is deliberately no override column and no reason column on this table.';
create index purchase_invoice_lines_invoice_idx on public.purchase_invoice_lines (invoice_id);
create index purchase_invoice_lines_po_line_idx on public.purchase_invoice_lines (po_line_id);

-- THE RULE. A differing rate is only possible through an amendment.
create or replace function public.check_invoice_rate_equals_po_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_po_rate numeric; v_item text; v_amd record;
begin
  if new.status = 'cancelled' then return new; end if;

  select l.rate, i.name into v_po_rate, v_item
  from public.purchase_order_lines l
  join public.items i on i.id = l.item_id
  where l.id = new.po_line_id;

  if new.rate = v_po_rate then
    if new.amendment_id is not null then
      raise exception 'This line is billed at the PO rate, so it must not point at an amendment.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- The rate differs. The only lawful route is a PO amendment.
  if new.amendment_id is null then
    raise exception '% is on the PO at % but this bill says %. The bill rate must equal the PO rate. Split the line by quantity and rate, and the difference will raise a PO amendment for the owner.',
      v_item, v_po_rate, new.rate using errcode = 'check_violation';
  end if;

  select * into v_amd from public.po_amendments where id = new.amendment_id;

  if v_amd.po_line_id <> new.po_line_id then
    raise exception 'That amendment belongs to a different PO line.' using errcode = 'check_violation';
  end if;

  if v_amd.new_rate <> new.rate then
    raise exception 'The amendment is for a rate of %, but this line is billed at %.',
      v_amd.new_rate, new.rate using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger purchase_invoice_lines_rate_guard
  before insert or update on public.purchase_invoice_lines
  for each row execute function public.check_invoice_rate_equals_po_rate();
revoke all on function public.check_invoice_rate_equals_po_rate() from public, anon, authenticated;

-- An invoice cannot be approved while an amendment behind it is unapproved.
create or replace function public.check_invoice_amendments_approved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_open int;
begin
  if new.status not in ('approved','completed') then return new; end if;

  select count(*) into v_open
  from public.purchase_invoice_lines il
  join public.po_amendments a on a.id = il.amendment_id
  where il.invoice_id = new.id
    and il.status <> 'cancelled'
    and a.approved_on is null;

  if v_open > 0 then
    raise exception 'This bill has % rate change(s) waiting for the owner to approve the PO amendment. The bill cannot be approved before the amendment is.', v_open
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger purchase_invoices_amendment_guard
  before update of status on public.purchase_invoices
  for each row execute function public.check_invoice_amendments_approved();
revoke all on function public.check_invoice_amendments_approved() from public, anon, authenticated;

-- ---------- Returns: challan return if unbilled, debit note if billed ----------
create table public.purchase_returns (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'draft',

  return_number text unique,
  return_type   text not null check (return_type in ('challan_return','debit_note')),
  po_id         uuid not null references public.purchase_orders(id),
  party_id      uuid not null references public.parties(id),
  grn_id        uuid references public.goods_receipts(id),
  invoice_id    uuid references public.purchase_invoices(id),
  return_date   date not null default current_date,
  reason        text not null,
  expect_back   text not null check (expect_back in ('replacement','credit')),
  transport_details text,
  approved_by_party_id uuid references public.parties(id),
  approved_on   timestamptz,
  settled_on    date,

  check (return_type <> 'challan_return' or (grn_id is not null and invoice_id is null)),
  check (return_type <> 'debit_note'     or invoice_id is not null)
);
comment on table public.purchase_returns is
  'On a challan and unbilled it is a return challan: the received quantity reduces, the PO line reopens and follow-ups restart. Once billed it is a DEBIT NOTE instead: the bill''s pending reduces and the vendor gets the note, so both sides agree the number.';
create index purchase_returns_po_idx on public.purchase_returns (po_id);
create index purchase_returns_pending_idx on public.purchase_returns (party_id) where settled_on is null;

create table public.purchase_return_lines (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'draft',

  return_id  uuid not null references public.purchase_returns(id),
  line_no    int not null check (line_no > 0),
  po_line_id uuid not null references public.purchase_order_lines(id),
  item_id    uuid not null references public.items(id),
  quantity   numeric(14,3) not null check (quantity > 0),
  rate       numeric(14,4) check (rate > 0),
  amount     numeric(18,4) generated always as (quantity * coalesce(rate,0)) stored,
  reason     text,
  unique (return_id, line_no)
);
create index purchase_return_lines_return_idx on public.purchase_return_lines (return_id);

-- ---------- Short close: not a cancellation ----------
create table public.short_closes (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'submitted',

  po_id         uuid not null references public.purchase_orders(id),
  po_line_id    uuid references public.purchase_order_lines(id),
  quantity_not_supplied numeric(14,3) check (quantity_not_supplied > 0),
  reason_code   text not null check (reason_code in (
                  'vendor_unable_to_supply','no_longer_required',
                  'found_cheaper_elsewhere','quality_unacceptable','delayed_beyond_use')),
  reason_note   text,
  requested_by_party_id uuid not null references public.parties(id),
  approved_by_party_id  uuid references public.parties(id),
  approved_on   timestamptz,
  flagged_to_owner boolean not null default false
);
comment on table public.short_closes is
  'Closing the unsupplied balance of a line, or a whole PO. It is NOT a cancellation -- part of it happened and the history stays. The quantity is recorded as NOT SUPPLIED, never as received, so it feeds a failure-to-supply rate: a vendor at 88% on-time who short-closes 15% of lines is not an 88% vendor.';
comment on column public.short_closes.flagged_to_owner is
  'Set when a short close has zero received and no follow-ups. That is someone tidying up rather than chasing, and the owner should see it.';
create index short_closes_po_idx on public.short_closes (po_id);

-- ---------- Payments: every payment names its bill ----------
create table public.vendor_payments (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  status         public.record_status default 'draft',

  payment_number text unique,
  party_id       uuid not null references public.parties(id),
  payment_date   date not null default current_date,
  amount         numeric(14,2) not null check (amount > 0),
  mode           text check (mode in ('bank','cash','cheque','upi','other')),
  bank_account_id uuid references public.party_bank_accounts(id),
  reference      text,
  remarks        text,
  approved_by_party_id uuid references public.parties(id),
  approved_on    timestamptz
);
comment on table public.vendor_payments is
  'A payment cannot be saved without naming at least one bill. Anything left over after the open bills becomes an unused advance rather than a floating credit nobody can explain.';
create index vendor_payments_party_idx on public.vendor_payments (party_id, payment_date desc);

create table public.vendor_payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  status      public.record_status default 'approved',

  payment_id  uuid not null references public.vendor_payments(id),
  invoice_id  uuid not null references public.purchase_invoices(id),
  amount      numeric(14,2) not null check (amount > 0),
  unique (payment_id, invoice_id)
);
comment on table public.vendor_payment_allocations is
  'Which bill each rupee of a payment went against. Allocated oldest first by default, every line overridable, and no line may exceed that bill''s pending amount.';
create index vendor_payment_allocations_invoice_idx on public.vendor_payment_allocations (invoice_id);

-- ---------- Advances: against a PO, and only that PO ----------
create table public.vendor_advances (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  status         public.record_status default 'approved',

  advance_number text unique,
  party_id       uuid not null references public.parties(id),
  po_id          uuid not null references public.purchase_orders(id),
  payment_id     uuid references public.vendor_payments(id),
  amount         numeric(14,2) not null check (amount > 0),
  paid_on        date not null default current_date,
  remarks        text
);
comment on table public.vendor_advances is
  'An advance is paid before any bill and is recorded against the PO, not against a bill. It adjusts ONLY on the PO it was paid against -- there is no cross-PO matching, and the payment screen showing a firm-wide position does not change that.';
create index vendor_advances_po_idx on public.vendor_advances (po_id);

create table public.vendor_advance_adjustments (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'approved',

  advance_id    uuid not null references public.vendor_advances(id),
  invoice_id    uuid references public.purchase_invoices(id),
  amount        numeric(14,2) not null check (amount > 0),

  moved_to_po_id uuid references public.purchase_orders(id),
  moved_reason   text,
  moved_approved_by_party_id uuid references public.parties(id),

  reversed_at   timestamptz,
  reversal_reason text,
  check (invoice_id is not null or moved_to_po_id is not null),
  check (moved_to_po_id is null or (moved_reason is not null and moved_approved_by_party_id is not null))
);
comment on table public.vendor_advance_adjustments is
  'Adjusting an advance is reversible -- recorded, never deleted. Leftover on a completed PO stays visible against that PO; moving it to another PO needs the owner and a reason, and both POs record it.';
create index vendor_advance_adjustments_advance_idx on public.vendor_advance_adjustments (advance_id);

-- An advance may only be adjusted against a bill on its OWN PO.
create or replace function public.check_advance_adjusts_same_po()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_adv_po uuid; v_inv_po uuid; v_adv text; v_inv text;
begin
  if new.invoice_id is null or new.status = 'cancelled' then return new; end if;

  select a.po_id, a.advance_number into v_adv_po, v_adv
    from public.vendor_advances a where a.id = new.advance_id;
  select i.po_id, i.invoice_number into v_inv_po, v_inv
    from public.purchase_invoices i where i.id = new.invoice_id;

  if v_adv_po <> v_inv_po then
    raise exception 'Advance % was paid against a different PO from bill %. An advance adjusts only on the PO it was paid against.',
      v_adv, v_inv using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
create trigger vendor_advance_adjustments_same_po_guard
  before insert or update on public.vendor_advance_adjustments
  for each row execute function public.check_advance_adjusts_same_po();
revoke all on function public.check_advance_adjusts_same_po() from public, anon, authenticated;

-- ---------- Laser cutting: the drawing is the control ----------
create table public.laser_drawings_sent (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  status             public.record_status default 'draft',

  drawing_ref        text unique,
  drawing_number     text not null,
  po_id              uuid references public.purchase_orders(id),
  party_id           uuid not null references public.parties(id),
  attachment_id      uuid not null references public.attachments(id),

  project_ref        text,
  customer_ref       text,
  estimated_weight_kg numeric(14,3) check (estimated_weight_kg > 0),
  expected_date      date,

  sent_at            timestamptz,
  sent_by_party_id   uuid references public.parties(id),
  whatsapp_sent_at   timestamptz,
  received_on        date
);
comment on table public.laser_drawings_sent is
  'attachment_id is NOT NULL on purpose: there is no Drawing Sent without an uploaded file. Drawings living on individual computers was flagged as a bigger risk than the purchase problem itself, and this column is what fixes it.';
comment on column public.laser_drawings_sent.project_ref is
  'Project, customer and estimated weight are visible to REF only. They are never printed on or sent with the vendor''s copy.';
create index laser_drawings_sent_party_idx on public.laser_drawings_sent (party_id);
create index laser_drawings_sent_pending_idx on public.laser_drawings_sent (sent_at) where received_on is null;

-- ============================================================
-- DERIVED NUMBERS — convention 6, no column to type them into
-- ============================================================
create view public.po_line_progress
with (security_invoker = true) as
select
  l.id as po_line_id,
  l.po_id,
  l.item_id,
  l.quantity as ordered_qty,
  coalesce((select sum(g.received_qty) from public.goods_receipt_lines g
             where g.po_line_id = l.id and g.status <> 'cancelled'), 0) as received_qty,
  coalesce((select sum(r.quantity) from public.purchase_return_lines r
             join public.purchase_returns pr on pr.id = r.return_id
             where r.po_line_id = l.id and r.status <> 'cancelled'
               and pr.status <> 'cancelled'), 0) as returned_qty,
  coalesce((select sum(il.quantity) from public.purchase_invoice_lines il
             join public.purchase_invoices pi on pi.id = il.invoice_id
             where il.po_line_id = l.id and il.status <> 'cancelled'
               and pi.status <> 'cancelled'), 0) as billed_qty,
  coalesce((select sum(sc.quantity_not_supplied) from public.short_closes sc
             where sc.po_line_id = l.id and sc.approved_on is not null), 0) as short_closed_qty
from public.purchase_order_lines l
where l.status <> 'cancelled';

comment on view public.po_line_progress is
  'Ordered, received, returned, billed and short-closed for every PO line, added up from the documents. Nothing here is stored anywhere.';

create view public.purchase_invoice_pending
with (security_invoker = true) as
select
  i.id as invoice_id,
  i.party_id,
  i.po_id,
  i.invoice_number,
  i.invoice_date,
  i.total_amount,
  coalesce((select sum(a.amount) from public.vendor_payment_allocations a
             join public.vendor_payments p on p.id = a.payment_id
             where a.invoice_id = i.id and a.status <> 'cancelled'
               and p.status <> 'cancelled'), 0) as paid_amount,
  coalesce((select sum(ad.amount) from public.vendor_advance_adjustments ad
             where ad.invoice_id = i.id and ad.status <> 'cancelled'
               and ad.reversed_at is null), 0) as advance_adjusted,
  coalesce((select sum(rl.amount) from public.purchase_return_lines rl
             join public.purchase_returns r on r.id = rl.return_id
             where r.invoice_id = i.id and r.return_type = 'debit_note'
               and r.status <> 'cancelled' and rl.status <> 'cancelled'), 0) as debit_note_amount,
  i.total_amount
    - coalesce((select sum(a.amount) from public.vendor_payment_allocations a
                 join public.vendor_payments p on p.id = a.payment_id
                 where a.invoice_id = i.id and a.status <> 'cancelled'
                   and p.status <> 'cancelled'), 0)
    - coalesce((select sum(ad.amount) from public.vendor_advance_adjustments ad
                 where ad.invoice_id = i.id and ad.status <> 'cancelled'
                   and ad.reversed_at is null), 0)
    - coalesce((select sum(rl.amount) from public.purchase_return_lines rl
                 join public.purchase_returns r on r.id = rl.return_id
                 where r.invoice_id = i.id and r.return_type = 'debit_note'
                   and r.status <> 'cancelled' and rl.status <> 'cancelled'), 0)
    as pending_amount,
  (current_date - (i.invoice_date + coalesce(vd.credit_days, 0))) as days_signed
from public.purchase_invoices i
left join public.vendor_details vd on vd.party_id = i.party_id
where i.status <> 'cancelled';

comment on view public.purchase_invoice_pending is
  'One signed number per bill: +3 means three days overdue, 0 means due today, -7 means seven days left. Credit days run from the INVOICE date, never the PO date. The bill drops off the list only when pending reaches zero.';

create view public.vendor_advance_balances
with (security_invoker = true) as
select
  a.id as advance_id,
  a.party_id,
  a.po_id,
  a.advance_number,
  a.paid_on,
  a.amount,
  coalesce((select sum(adj.amount) from public.vendor_advance_adjustments adj
             where adj.advance_id = a.id and adj.status <> 'cancelled'
               and adj.reversed_at is null), 0) as adjusted_amount,
  a.amount - coalesce((select sum(adj.amount) from public.vendor_advance_adjustments adj
             where adj.advance_id = a.id and adj.status <> 'cancelled'
               and adj.reversed_at is null), 0) as unused_amount
from public.vendor_advances a
where a.status <> 'cancelled';

create view public.received_not_billed
with (security_invoker = true) as
select
  g.party_id,
  g.po_id,
  g.id as grn_id,
  g.challan_number,
  g.challan_date,
  (current_date - g.challan_date) as days_since_challan
from public.goods_receipts g
where g.status <> 'cancelled'
  and not exists (
    select 1 from public.purchase_invoices i
    where i.po_id = g.po_id and i.status <> 'cancelled'
  );

comment on view public.received_not_billed is
  'Material in the plant with no bill against it. Money already owed that cannot otherwise be seen. Anything past 30 days is worth chasing.';

-- ---------- Conventions and security ----------
select public.attach_conventions('goods_receipts', true);
select public.attach_conventions('goods_receipt_lines');
select public.attach_conventions('purchase_invoices', true);
select public.attach_conventions('purchase_invoice_lines');
select public.attach_conventions('purchase_returns', true);
select public.attach_conventions('purchase_return_lines');
select public.attach_conventions('short_closes', true);
select public.attach_conventions('vendor_payments', true);
select public.attach_conventions('vendor_payment_allocations');
select public.attach_conventions('vendor_advances', true);
select public.attach_conventions('vendor_advance_adjustments');
select public.attach_conventions('laser_drawings_sent', true);

do $$
declare
  t text;
  spec text[][] := array[
    ['goods_receipts',            'goods_receipt.view',   'goods_receipt.create',  'goods_receipt.create'],
    ['goods_receipt_lines',       'goods_receipt.view',   'goods_receipt.create',  'goods_receipt.create'],
    ['purchase_invoices',         'purchase_invoice.view','purchase_invoice.create','purchase_invoice.edit'],
    ['purchase_invoice_lines',    'purchase_invoice.view','purchase_invoice.create','purchase_invoice.edit'],
    ['purchase_returns',          'purchase_return.view', 'purchase_return.create','purchase_return.create'],
    ['purchase_return_lines',     'purchase_return.view', 'purchase_return.create','purchase_return.create'],
    ['short_closes',              'purchase_order.view',  'purchase_order.create', 'short_close.approve'],
    ['vendor_payments',           'vendor_payment.view',  'vendor_payment.create', 'vendor_payment.approve'],
    ['vendor_payment_allocations','vendor_payment.view',  'vendor_payment.create', 'vendor_payment.approve'],
    ['vendor_advances',           'vendor_payment.view',  'vendor_payment.create', 'vendor_payment.approve'],
    ['vendor_advance_adjustments','vendor_payment.view',  'vendor_payment.create', 'vendor_payment.approve'],
    ['laser_drawings_sent',       'laser_drawing.view',   'laser_drawing.create',  'laser_drawing.create']
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
    execute format($f$
      create policy %I on public.%I for insert to authenticated
        with check (public.has_permission(%L) or public.is_owner())
    $f$, t || '_insert', t, spec[i][3]);
    execute format($f$
      create policy %I on public.%I for update to authenticated
        using (public.has_permission(%L) or public.is_owner())
        with check (public.has_permission(%L) or public.is_owner())
    $f$, t || '_update', t, spec[i][4], spec[i][4]);
  end loop;
end $$;
