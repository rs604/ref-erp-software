-- ============================================================
-- 04 LOGIN, PERMISSIONS, SECURITY
-- Login is Supabase Auth. The hand-built login from Tokyo
-- (employees.pin, password_hash, employee_sessions,
-- password_reset_tokens) is retired and is NOT recreated.
-- ============================================================

create table public.user_accounts (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  status               public.record_status default 'draft',

  party_id             uuid not null unique references public.parties(id),
  auth_user_id         uuid unique references auth.users(id) on delete set null,
  login_email          text not null unique,

  -- Two-step login: a tickbox on the user record, OFF by default.
  -- Intended for owner and accounts staff, not forced on everyone.
  two_step_enabled     boolean not null default false,
  two_step_method      text not null default 'email' check (two_step_method in ('email','totp')),

  must_change_password boolean not null default true,
  is_locked            boolean not null default false,
  failed_attempts      int not null default 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  last_login_ip        inet
);

comment on table public.user_accounts is
  'One row per party who can log in. Identity lives in parties; this row only carries how they sign in.';
comment on column public.user_accounts.two_step_enabled is
  'Two-step login for this one user. Off by default. Turned on per person, meant for owner and accounts.';

create index user_accounts_auth_idx on public.user_accounts (auth_user_id);

-- ---------- Permission catalogue ----------
create table public.permissions (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  status     public.record_status default 'approved',

  key        text not null unique,
  sub_head   text not null,
  action     text not null,
  label      text not null,
  category   text not null,
  sort_order int not null default 0
);

comment on table public.permissions is
  'The catalogue of things that can be permitted. sub_head + action make the key, e.g. employee_master.edit.';

create table public.party_permissions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'approved',

  party_id      uuid not null references public.parties(id),
  permission_id uuid not null references public.permissions(id),
  granted_by    uuid references public.parties(id),
  unique (party_id, permission_id)
);
create index party_permissions_party_idx on public.party_permissions (party_id);

comment on table public.party_permissions is
  'Who holds which permission. Owner needs no rows here -- owner holds everything.';

-- ---------- Record every login ----------
create table public.login_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'completed',

  occurred_at   timestamptz not null default now(),
  event         text not null check (event in
                  ('login_success','login_failed','logout','two_step_sent',
                   'two_step_passed','two_step_failed','password_reset_requested',
                   'password_changed','account_locked','account_unlocked')),
  login_email   text,
  auth_user_id  uuid,
  party_id      uuid references public.parties(id),
  ip_address    inet,
  user_agent    text,
  detail        text
);

comment on table public.login_log is
  'Every login attempt, success or failure, and every password change. Append-only. Answers "who got in, from where, when".';

create index login_log_party_idx on public.login_log (party_id, occurred_at desc);
create index login_log_email_idx on public.login_log (login_email, occurred_at desc);
create index login_log_event_idx on public.login_log (event, occurred_at desc);

-- ---------- Two-step codes ----------
create table public.two_step_codes (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  status        public.record_status default 'draft',

  auth_user_id  uuid not null,
  code_hash     text not null,
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  attempts      int not null default 0,
  ip_address    inet
);
create index two_step_codes_user_idx on public.two_step_codes (auth_user_id, expires_at desc);

comment on table public.two_step_codes is
  'Short-lived second-step codes, stored hashed only. Never store the code itself -- the Tokyo system stored temporary passwords in plain text and that is not repeated here.';

select public.attach_conventions('user_accounts', true);
select public.attach_conventions('permissions');
select public.attach_conventions('party_permissions');
select public.attach_conventions('two_step_codes');
-- login_log deliberately has no audit trigger: it is already an append-only log,
-- and auditing it would double every row.
create trigger login_log_set_updated_at before update on public.login_log
  for each row execute function public.set_updated_at();
