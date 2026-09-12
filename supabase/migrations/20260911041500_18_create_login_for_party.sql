-- ============================================================
-- create_login_for_party — the one place a login is made.
--
-- Why this exists: GoTrue reads a handful of token columns on every
-- sign-in. Writing an auth.users row by hand leaves them NULL, and the
-- person then gets "Database error querying schema" and cannot sign in
-- at all. Every one of those columns is written here as an empty
-- string, so the trap is fixed once instead of in every function that
-- ever needs to make a login.
--
-- The password handed in is expected to be long and random and known to
-- nobody. The person gets in through the "forgotten password" link.
-- No password is ever stored in a table of ours or returned anywhere.
--
-- SECURITY DEFINER with search_path pinned, and EXECUTE revoked from
-- everyone but the service role, so only an Edge Function can call it.
-- ============================================================

create or replace function public.create_login_for_party(
  p_party_id uuid,
  p_login_email text,
  p_password text
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth', 'extensions', 'pg_temp'
as $$
declare
  v_email text := lower(trim(p_login_email));
  v_uid   uuid := gen_random_uuid();
begin
  if p_party_id is null then raise exception 'party_id is required'; end if;
  if v_email is null or v_email = '' then raise exception 'login email is required'; end if;
  if p_password is null or length(p_password) < 12 then
    raise exception 'a long random password is required';
  end if;

  if not exists (select 1 from public.parties where id = p_party_id) then
    raise exception 'That person does not exist';
  end if;
  if exists (select 1 from public.user_accounts where party_id = p_party_id) then
    raise exception 'That person already has a login';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'That email address is already in use';
  end if;

  -- GoTrue reads these columns on every sign-in. A NULL in any of them
  -- makes sign-in fail with "Database error querying schema", so every
  -- one of them is written as an empty string, never left NULL.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, email_change,
    phone_change, phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
    '{}'::jsonb,
    '', '', '', '', '', '', '', '',
    false, false
  );

  -- auth.identities.email is a generated column here -- it comes from
  -- identity_data, so it is never written directly.
  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid::text, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email,
                       'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  insert into public.user_accounts (
    party_id, auth_user_id, login_email, status,
    must_change_password, two_step_enabled
  ) values (
    p_party_id, v_uid, v_email, 'approved', true, false
  );

  return v_uid;
end;
$$;

revoke all on function public.create_login_for_party(uuid, text, text) from public;
revoke all on function public.create_login_for_party(uuid, text, text) from anon;
revoke all on function public.create_login_for_party(uuid, text, text) from authenticated;
grant execute on function public.create_login_for_party(uuid, text, text) to service_role;
