-- ============================================================
-- 19 THE FIRST ACCOUNT
-- Raghbir, as a party with the owner role and a login.
-- The password set here is random and is thrown away -- he sets his
-- own through the "forgot password" link on the login screen, so
-- nobody, including this session, ever knows it.
-- ============================================================

do $$
declare
  v_party_id uuid;
  v_auth_id  uuid := gen_random_uuid();
  v_number   text;
begin
  -- 1. The person
  v_number := public.next_human_number('employee');

  insert into public.parties (party_type, display_name, legal_name, party_number,
                              primary_email, status)
  values ('person', 'Raghbir Singh', 'Raghbir Singh', v_number,
          'rs@refconveyors.com', 'approved')
  returning id into v_party_id;

  -- 2. What he is to the business
  insert into public.party_roles (party_id, role, status)
  values (v_party_id, 'owner', 'approved'),
         (v_party_id, 'employee', 'approved');

  -- 3. The employment record
  insert into public.employee_details (party_id, date_of_joining, employment_state, status)
  values (v_party_id, current_date, 'active', 'approved');

  -- 4. The login itself
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
  ) values (
    v_auth_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'rs@refconveyors.com',
    extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Raghbir Singh'),
    false, false
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_auth_id, v_auth_id::text, 'email',
    jsonb_build_object('sub', v_auth_id::text, 'email', 'rs@refconveyors.com',
                       'email_verified', true, 'phone_verified', false),
    null, now(), now()
  );

  -- 5. Tie the login to the person
  insert into public.user_accounts (
    party_id, auth_user_id, login_email,
    two_step_enabled, must_change_password, status
  ) values (
    v_party_id, v_auth_id, 'rs@refconveyors.com',
    false,   -- owner two-step: available, left off until he asks for it
    true,    -- he must set his own password on first sign-in
    'approved'
  );

  raise notice 'Owner created: party % (%), auth user %', v_party_id, v_number, v_auth_id;
end $$;
