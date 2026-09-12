-- ============================================================
-- 22 VENDOR MASTER — THE LOCKED DESIGN (doc 09)
--
-- Extends the vendor tables. Nothing is rebuilt, no column dropped.
-- vendor_details had 0 rows, so every rule below costs nothing today.
--
-- Status vocabulary: doc 09 talks about draft / pending_approval /
-- approved / rejected. The database has one status list for everything
-- (convention 3), so those map onto it:
--     pending_approval -> submitted      rejected -> cancelled
-- The ban is NOT a status. is_blacklisted is its only home, because
-- writing "blacklisted" into status erased "approved" in the old design.
-- ============================================================

-- ---------- The rest of the vendor form ----------
alter table public.vendor_details
  add column business_types      text[] check (business_types <@ array['manufacturer','trader','service','exporter']::text[]),
  add column deals_in            text,
  add column needs_update        boolean not null default false,
  add column needs_update_reason text,
  add column needs_update_since  date,
  add column blacklisted_by      uuid references public.parties(id),
  add column unblacklisted_on    date,
  add column details_checked_on  date;

comment on column public.vendor_details.business_types is
  'Multi-select: manufacturer, trader, service, exporter. A firm is often more than one.';
comment on column public.vendor_details.deals_in is
  'Free typing from the visiting card, comma separated. Deliberately not a ticked list of item groups -- that is too much maintenance to stay true.';
comment on column public.vendor_details.needs_update is
  'One general flag, with the reason in words beside it. New reasons get added later with no redesign. What it blocks depends on the reason: a dead IFSC blocks payment, a stale record only asks for confirmation on the next PO.';
comment on column public.vendor_details.details_checked_on is
  'Set when someone confirms the vendor is still current. Un-blacklisting returns a vendor to approved marked "details not checked since this date".';

-- The locked dropdown. 0 days means cash.
alter table public.vendor_details add constraint vendor_details_credit_days_locked
  check (credit_days is null or credit_days in (0,7,15,30,45,60,90));
comment on column public.vendor_details.credit_days is
  'One of 7 / 15 / 30 / 45 / 60 / 90, or 0 meaning cash. Counted from the INVOICE date, never the PO date -- one PO can bring three deliveries and three bills.';

-- A flag with no reason on it is noise.
alter table public.vendor_details add constraint vendor_details_needs_update_has_reason
  check (not needs_update or needs_update_reason is not null);

create index vendor_details_needs_update_idx on public.vendor_details (needs_update) where needs_update;
create index vendor_details_blacklisted_idx  on public.vendor_details (is_blacklisted) where is_blacklisted;

-- ---------- Where the branch actually is ----------
alter table public.party_addresses
  add column map_location text,
  add column latitude     numeric(9,6) check (latitude between -90 and 90),
  add column longitude    numeric(9,6) check (longitude between -180 and 180);

comment on column public.party_addresses.map_location is
  'A Maps link, or a dropped pin as latitude and longitude. A pin always works for a unit with no Google listing. Whether it is mandatory is a setting, off by default.';

-- ---------- Groups: same people, different GST number ----------
create table public.party_group_links (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  status          public.record_status default 'approved',

  party_id        uuid not null references public.parties(id),
  linked_party_id uuid not null references public.parties(id),
  group_name      text,
  note            text,
  check (party_id <> linked_party_id),
  unique (party_id, linked_party_id)
);
comment on table public.party_group_links is
  'Two separate vendors that are the same group under different GST numbers. The point of the link is that you can see what each unit of one group quoted for the same item -- same people, different price. A unit sharing the vendor''s own GST is a branch (party_addresses), not this.';
create index party_group_links_party_idx  on public.party_group_links (party_id);
create index party_group_links_linked_idx on public.party_group_links (linked_party_id);

-- ---------- PAN must agree with what the party is ----------
-- Doc 09: fourth letter C for a company, P for an individual. Catches a
-- personal PAN typed onto a company record.
alter table public.parties add constraint parties_pan_matches_party_type
  check (
    pan is null
    or (party_type = 'company' and substring(pan from 4 for 1) = 'C')
    or (party_type = 'person'  and substring(pan from 4 for 1) = 'P')
  );

-- ---------- A GSTIN must carry its owner's PAN ----------
-- Characters 3 to 12 of a GSTIN are the PAN. Catches a mistyped GSTIN
-- with no external lookup and no internet call.
create or replace function public.check_gstin_matches_pan()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_pan text;
begin
  if new.gstin is null or new.status = 'cancelled' then
    return new;
  end if;

  select p.pan into v_pan from public.parties p where p.id = new.party_id;

  if v_pan is not null and substring(new.gstin from 3 for 10) <> v_pan then
    raise exception 'GSTIN % does not carry this party''s PAN (%). Characters 3 to 12 of a GST number are always the PAN.',
      new.gstin, v_pan
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger party_addresses_gstin_pan_guard
  before insert or update of gstin, party_id, status on public.party_addresses
  for each row execute function public.check_gstin_matches_pan();

revoke all on function public.check_gstin_matches_pan() from public, anon, authenticated;

-- ---------- Duplicates are blocked, and the block names the holder ----------
-- Doc 09: a salesman at two firms is LINKED, never retyped. So the
-- message has to say who already has the number, not just refuse.
create or replace function public.check_party_contact_number_unique()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_holder text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if new.primary_mobile is not null then
    select p.display_name into v_holder
    from public.parties p
    where p.primary_mobile = new.primary_mobile
      and p.id <> new.id
      and p.status <> 'cancelled'
    limit 1;
    if v_holder is not null then
      raise exception 'Mobile % already belongs to %. Link that record instead of entering it again.',
        new.primary_mobile, v_holder using errcode = 'unique_violation';
    end if;
  end if;

  if new.landline is not null then
    select p.display_name into v_holder
    from public.parties p
    where p.landline = new.landline
      and p.id <> new.id
      and p.status <> 'cancelled'
    limit 1;
    if v_holder is not null then
      raise exception 'Landline % already belongs to %.',
        new.landline, v_holder using errcode = 'unique_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger parties_contact_number_guard
  before insert or update of primary_mobile, landline, status on public.parties
  for each row execute function public.check_party_contact_number_unique();

revoke all on function public.check_party_contact_number_unique() from public, anon, authenticated;

create or replace function public.check_contact_mobile_unique()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_holder text;
begin
  if new.mobile is null or new.status = 'cancelled' then
    return new;
  end if;

  select p.display_name into v_holder
  from public.party_contacts c
  join public.parties p on p.id = c.party_id
  where c.mobile = new.mobile
    and c.party_id <> new.party_id
    and c.status <> 'cancelled'
  limit 1;

  if v_holder is not null then
    raise exception 'Mobile % is already a contact at %. The same person at two firms is linked, not entered twice.',
      new.mobile, v_holder using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

create trigger party_contacts_mobile_guard
  before insert or update of mobile, party_id, status on public.party_contacts
  for each row execute function public.check_contact_mobile_unique();

revoke all on function public.check_contact_mobile_unique() from public, anon, authenticated;

-- One bank account belongs to one party. Paying the wrong firm because a
-- number was reused is the expensive version of this mistake.
create or replace function public.check_bank_account_unique()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_holder text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  select p.display_name into v_holder
  from public.party_bank_accounts b
  join public.parties p on p.id = b.party_id
  where b.account_number = new.account_number
    and b.ifsc = new.ifsc
    and b.party_id <> new.party_id
    and b.status <> 'cancelled'
  limit 1;

  if v_holder is not null then
    raise exception 'Account % at % already belongs to %.',
      new.account_number, new.ifsc, v_holder using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

create trigger party_bank_accounts_unique_guard
  before insert or update of account_number, ifsc, party_id, status on public.party_bank_accounts
  for each row execute function public.check_bank_account_unique();

revoke all on function public.check_bank_account_unique() from public, anon, authenticated;

-- ---------- MSME means Udyam, and Udyam means a number ----------
-- MSME status shortens the legal payment deadline to 45 days, so an
-- unverifiable claim must not be accepted.
create or replace function public.check_msme_has_udyam()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_udyam text;
begin
  if not new.is_msme or new.status in ('draft','cancelled') then
    return new;
  end if;

  select p.msme_number into v_udyam from public.parties p where p.id = new.party_id;

  if v_udyam is null or btrim(v_udyam) = '' then
    raise exception 'MSME is ticked but there is no Udyam number. MSME status shortens the payment deadline to 45 days, so the number is needed before this vendor is submitted.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger vendor_details_msme_guard
  before insert or update of is_msme, status, party_id on public.vendor_details
  for each row execute function public.check_msme_has_udyam();

revoke all on function public.check_msme_has_udyam() from public, anon, authenticated;

-- ---------- Conventions and security on the new table ----------
select public.attach_conventions('party_group_links');

alter table public.party_group_links enable row level security;

create policy party_group_links_read on public.party_group_links for select to authenticated
  using (public.has_permission('vendor_master.view')
      or public.has_permission('vendor_data_bank.view'));
create policy party_group_links_insert on public.party_group_links for insert to authenticated
  with check (public.has_permission('vendor_master.create')
           or public.has_permission('vendor_master.edit'));
create policy party_group_links_update on public.party_group_links for update to authenticated
  using (public.has_permission('vendor_master.edit'))
  with check (public.has_permission('vendor_master.edit'));
