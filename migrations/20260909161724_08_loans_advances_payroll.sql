-- ============================================================
-- 08 LOANS, ADVANCES, PAYROLL
-- Every one of these is a document: a header saying who and when,
-- and lines saying what and how much. Balances are never typed in.
-- ============================================================

-- ---------- Loans: header ----------
create table public.employee_loans (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  status            public.record_status default 'draft',

  document_number   text unique,
  party_id          uuid not null references public.parties(id),
  loan_date         date not null default current_date,
  principal         numeric(12,2) not null check (principal > 0),
  instalment_amount numeric(12,2) not null check (instalment_amount > 0),
  instalment_count  int check (instalment_count > 0),
  first_recovery_month date not null,
  reason            text,
  approved_by       uuid references public.parties(id),
  approved_on       timestamptz,
  closed_on         date
);
create index employee_loans_party_idx on public.employee_loans (party_id, loan_date desc);

comment on table public.employee_loans is
  'A loan given to an employee, recovered over several months. The amount still owed is NOT stored here -- it is added up from the lines.';

-- ---------- Loans: lines ----------
create table public.employee_loan_transactions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'completed',

  loan_id      uuid not null references public.employee_loans(id),
  txn_month    date not null,
  txn_type     text not null check (txn_type in ('disbursement','recovery','waiver','adjustment')),
  amount       numeric(12,2) not null check (amount > 0),
  payroll_entry_id uuid,
  remarks      text
);
create index employee_loan_txn_loan_idx on public.employee_loan_transactions (loan_id, txn_month);

-- ---------- Advances: header ----------
create table public.employee_advances (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  status           public.record_status default 'draft',

  document_number  text unique,
  party_id         uuid not null references public.parties(id),
  advance_date     date not null default current_date,
  amount           numeric(12,2) not null check (amount > 0),
  recovery_month   date not null,
  reason           text,
  approved_by      uuid references public.parties(id),
  approved_on      timestamptz,
  closed_on        date
);
create index employee_advances_party_idx on public.employee_advances (party_id, advance_date desc);

comment on table public.employee_advances is
  'Salary paid early, normally recovered the same month. Anything not recovered carries forward, which the lines show.';

-- ---------- Advances: lines ----------
create table public.employee_advance_transactions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  status       public.record_status default 'completed',

  advance_id   uuid not null references public.employee_advances(id),
  txn_month    date not null,
  txn_type     text not null check (txn_type in ('disbursement','recovery','waiver','adjustment')),
  amount       numeric(12,2) not null check (amount > 0),
  payroll_entry_id uuid,
  remarks      text
);
create index employee_advance_txn_idx on public.employee_advance_transactions (advance_id, txn_month);

-- ---------- Payroll: header ----------
create table public.payroll_periods (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  status             public.record_status default 'draft',

  document_number    text unique,
  period_month       date not null unique,
  days_in_month      int not null check (days_in_month between 28 and 31),

  -- the rules as they stood when the sheet was made, so an old month
  -- still recalculates the same way after the rules change
  esi_wage_ceiling   numeric(12,2),
  esi_employee_rate  numeric(6,3),
  esi_employer_rate  numeric(6,3),
  pf_applicable      boolean not null default false,
  pf_wage_ceiling    numeric(12,2),
  pf_employee_rate   numeric(6,3),

  finalised_at       timestamptz,
  finalised_by       uuid references public.parties(id),
  remarks            text
);

comment on table public.payroll_periods is
  'One salary sheet per month. The ESI and PF rules are copied in when the sheet is created, so re-opening an old month does not silently use today rules.';

-- ---------- Payroll: lines ----------
create table public.payroll_entries (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  status              public.record_status default 'draft',

  period_id           uuid not null references public.payroll_periods(id),
  party_id            uuid not null references public.parties(id),

  basic_wages         numeric(12,2) not null default 0 check (basic_wages >= 0),
  days_present        numeric(5,2) not null default 0 check (days_present >= 0),
  overtime_hours      numeric(6,2) not null default 0 check (overtime_hours >= 0),
  overtime_rate       numeric(10,2) not null default 0 check (overtime_rate >= 0),

  earned_wages        numeric(12,2) not null default 0,
  overtime_amount     numeric(12,2) not null default 0,
  incentive           numeric(12,2) not null default 0,
  incentive_remarks   text,
  other_earnings      numeric(12,2) not null default 0,
  total_earnings      numeric(12,2) not null default 0,

  esi_employee        numeric(12,2) not null default 0,
  esi_employer        numeric(12,2) not null default 0,
  pf_employee         numeric(12,2) not null default 0,
  loan_deduction      numeric(12,2) not null default 0 check (loan_deduction >= 0),
  advance_deduction   numeric(12,2) not null default 0 check (advance_deduction >= 0),
  other_deductions    numeric(12,2) not null default 0,
  total_deductions    numeric(12,2) not null default 0,

  net_payable         numeric(12,2) not null default 0,
  remarks             text,

  unique (period_id, party_id)
);
create index payroll_entries_period_idx on public.payroll_entries (period_id);
create index payroll_entries_party_idx  on public.payroll_entries (party_id);

alter table public.employee_loan_transactions
  add constraint employee_loan_txn_payroll_fk
  foreign key (payroll_entry_id) references public.payroll_entries(id);

alter table public.employee_advance_transactions
  add constraint employee_advance_txn_payroll_fk
  foreign key (payroll_entry_id) references public.payroll_entries(id);

-- ---------- Convention 6: balances are derived, never typed ----------
create view public.loan_balances
with (security_invoker = true) as
select
  l.id                as loan_id,
  l.party_id,
  l.document_number,
  l.principal,
  coalesce(sum(t.amount) filter (where t.txn_type = 'recovery'   and t.status <> 'cancelled'), 0) as recovered,
  coalesce(sum(t.amount) filter (where t.txn_type = 'waiver'     and t.status <> 'cancelled'), 0) as waived,
  coalesce(sum(t.amount) filter (where t.txn_type = 'adjustment' and t.status <> 'cancelled'), 0) as adjusted,
  l.principal
    - coalesce(sum(t.amount) filter (where t.txn_type in ('recovery','waiver') and t.status <> 'cancelled'), 0)
    + coalesce(sum(t.amount) filter (where t.txn_type = 'adjustment' and t.status <> 'cancelled'), 0) as outstanding,
  l.status
from public.employee_loans l
left join public.employee_loan_transactions t on t.loan_id = l.id
group by l.id;

comment on view public.loan_balances is
  'What is still owed on each loan, worked out from the lines. There is deliberately no column anywhere to type this number into.';

create view public.advance_balances
with (security_invoker = true) as
select
  a.id            as advance_id,
  a.party_id,
  a.document_number,
  a.amount,
  coalesce(sum(t.amount) filter (where t.txn_type = 'recovery' and t.status <> 'cancelled'), 0) as recovered,
  a.amount - coalesce(sum(t.amount) filter (where t.txn_type in ('recovery','waiver') and t.status <> 'cancelled'), 0) as outstanding,
  a.status
from public.employee_advances a
left join public.employee_advance_transactions t on t.advance_id = a.id
group by a.id;

select public.attach_conventions('employee_loans', true);
select public.attach_conventions('employee_loan_transactions');
select public.attach_conventions('employee_advances', true);
select public.attach_conventions('employee_advance_transactions');
select public.attach_conventions('payroll_periods', true);
select public.attach_conventions('payroll_entries');
