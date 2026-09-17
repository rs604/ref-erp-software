-- ============================================================
-- 18 TWO CORRECTIONS AGREED 10 SEP, BEFORE ANY VENDOR EXISTS
--
--  (1) GSTIN belongs to the branch, not the vendor. A Ludhiana vendor
--      with a Delhi godown has two GST numbers, and the PO must print
--      the right one.
--  (2) Aadhaar: keep the last four digits only. Nothing to mask,
--      nothing to leak. PAN is the field that matters for TDS, and the
--      full Aadhaar is on the uploaded document, where file permissions
--      already control it properly.
-- ============================================================

-- ---------- (1) GSTIN moves to the branch ----------
alter table public.party_addresses
  add column gstin text
    check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$');

comment on column public.party_addresses.gstin is
  'The GST number registered at THIS place. A vendor with units in two states has two, one per branch.';

create index party_addresses_gstin_idx on public.party_addresses (gstin) where gstin is not null;

-- Rule: the same GSTIN may repeat across branches of the same vendor
-- (two units in one state share a number), but a GSTIN already held by a
-- DIFFERENT party is blocked, and the block names the holder.
create or replace function public.check_gstin_not_held_elsewhere()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_holder text;
begin
  if new.gstin is null or new.status = 'cancelled' then
    return new;
  end if;

  select p.display_name
    into v_holder
  from public.party_addresses a
  join public.parties p on p.id = a.party_id
  where a.gstin = new.gstin
    and a.party_id <> new.party_id
    and a.status <> 'cancelled'
  limit 1;

  if v_holder is not null then
    raise exception 'GSTIN % is already registered to %. One GST number cannot belong to two vendors.',
      new.gstin, v_holder
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

create trigger party_addresses_gstin_guard
  before insert or update of gstin, party_id, status on public.party_addresses
  for each row execute function public.check_gstin_not_held_elsewhere();

revoke all on function public.check_gstin_not_held_elsewhere() from public, anon, authenticated;

-- The old single GSTIN on parties is removed rather than left to drift.
-- Keeping the same fact in two places is exactly the bug that put
-- "blacklisted" into the status column in the Tokyo design.
drop index if exists public.parties_gstin_uidx;
alter table public.parties drop column gstin;

-- Convenience only, never a second home for the fact: the GST number on the
-- vendor's primary address.
create view public.party_primary_gstin
with (security_invoker = true) as
select
  p.id as party_id,
  p.display_name,
  a.id as address_id,
  a.gstin
from public.parties p
left join public.party_addresses a
  on a.party_id = p.id
 and a.is_primary
 and a.status <> 'cancelled';

-- ---------- (2) Aadhaar: last four digits only ----------
drop index if exists public.parties_aadhaar_uidx;
alter table public.parties drop column aadhaar;

alter table public.parties
  add column aadhaar_last4 text check (aadhaar_last4 ~ '^[0-9]{4}$');

comment on column public.parties.aadhaar_last4 is
  'The last four digits of the Aadhaar number and nothing else -- enough to tell one contractor from another. The full number is never stored. If it is ever genuinely needed it is on the uploaded document, where file permissions control it.';
