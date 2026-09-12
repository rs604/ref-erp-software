-- ============================================================
-- 13 LOCK DOWN THE FUNCTIONS
-- A SECURITY DEFINER function runs with the powers of its owner.
-- Nothing that is not needed by a signed-in screen is callable at all,
-- and nothing at all is callable by a stranger who has not logged in.
-- ============================================================

-- Trigger functions: fired by the database itself, never called by a person.
-- Postgres checks EXECUTE when the trigger is created, not when it fires,
-- so revoking here does not stop the triggers working.
revoke all on function public.log_audit()                from public, anon, authenticated;
revoke all on function public.log_event()                from public, anon, authenticated;
revoke all on function public.set_updated_at()           from public, anon, authenticated;
revoke all on function public.block_attachment_delete()  from public, anon, authenticated;
revoke all on function public.attach_conventions(text, boolean) from public, anon, authenticated;

-- Identity helpers: needed by the security rules, so signed-in users only.
revoke all on function public.current_party_id()      from public, anon;
revoke all on function public.is_owner()              from public, anon;
revoke all on function public.has_permission(text)    from public, anon;
grant execute on function public.current_party_id()   to authenticated;
grant execute on function public.is_owner()           to authenticated;
grant execute on function public.has_permission(text) to authenticated;

-- Business helpers: signed-in users only.
revoke all on function public.next_human_number(text) from public, anon;
grant execute on function public.next_human_number(text) to authenticated;

revoke all on function public.replace_attachment(uuid, text, text, bigint, text, text, text)
  from public, anon;
grant execute on function public.replace_attachment(uuid, text, text, bigint, text, text, text)
  to authenticated;

revoke all on function public.current_salary(uuid, date) from public, anon;
grant execute on function public.current_salary(uuid, date) to authenticated;

-- two_step_codes is deliberately unreachable from any screen. Only the login
-- function, which runs with the service key, may touch it. This policy exists
-- to say so out loud rather than leaving an empty table looking forgotten.
create policy two_step_codes_no_client_access on public.two_step_codes
  for all to authenticated, anon
  using (false) with check (false);

comment on table public.two_step_codes is
  'No screen may read or write this table -- the policy denies everyone. Only the login edge function, running with the service key, uses it.';
