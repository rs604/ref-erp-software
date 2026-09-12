-- ============================================================
-- 20 FIELDS THE EMPLOYEE SCREEN ASKS FOR
--
-- The screen has boxes for these and the Tokyo table had columns for
-- them. The Mumbai rebuild left them out, so the boxes would open blank
-- and saving would quietly wipe whatever was typed. No data exists yet,
-- so nothing is lost -- but the boxes have to work.
--
-- Each field is put where it actually belongs: things true of the person
-- go on parties, things true of the employment go on employee_details.
-- ============================================================

-- ---------- True of the person, whatever they are to us ----------
alter table public.parties
  add column marital_status  text check (marital_status in ('single','married','widowed','divorced','other')),
  add column religion         text,
  add column place_of_birth   text,
  add column landline         text,
  add column guardian_relation text check (guardian_relation in ('father','husband','mother','guardian','other'));

comment on column public.parties.guardian_relation is
  'Whether father_name holds a father''s or a husband''s name. The form asks it that way.';
comment on column public.parties.landline is
  'Home or office landline. Free text -- ranges and extensions are normal here.';

-- ---------- True of the employment ----------
alter table public.employee_details
  add column wage_type              text check (wage_type in ('monthly','daily','hourly','piece_rate')),
  add column salary_payment_method  text check (salary_payment_method in ('bank','cash','cheque','upi')),
  add column pf_number              text,
  add column esi_dispensary         text,

  add column emergency_contact_relation text,
  add column emergency_contact_address  text,

  add column driving_license_number   text,
  add column driving_license_category  text,
  add column driving_license_validity  date,

  add column source_of_employee    text,
  add column referred_by_party_id  uuid references public.parties(id),
  add column referred_by_name      text,
  add column referred_by_contact   text;

comment on column public.employee_details.referred_by_party_id is
  'If the person who referred them is already on the system, this points at them -- one identity, not a retyped name. referred_by_name is for anyone not on the system.';
comment on column public.employee_details.driving_license_validity is
  'Expiry date. A driver with an expired licence is a real liability, so this is a date, not text.';

create index employee_details_referred_by_idx on public.employee_details (referred_by_party_id);
create index employee_details_dl_validity_idx on public.employee_details (driving_license_validity)
  where driving_license_validity is not null;
