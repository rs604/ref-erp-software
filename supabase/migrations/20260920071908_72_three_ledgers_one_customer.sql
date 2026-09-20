-- ============================================================
-- 72 THREE LEDGERS, ONE CUSTOMER, AND NOBODY LOOKING
--
-- Busy holds one ledger per NAME, so a party entered twice with a full
-- stop in a different place is two ledgers with two balances. Nothing in
-- Busy says so and nothing in the ERP said so either: the screen showed
-- one balance and it read as the whole picture.
--
-- THE ERP DOES NOT MERGE THEM. A ledger shows what Busy holds, not what
-- the ERP thinks it should hold. Merging here would hide the very thing
-- that needs correcting, and it would be correcting it in the wrong
-- book. All this does is SAY SO, next to the balance, so nobody adds two
-- of them together by accident or takes the first for the total.
--
-- WHAT COUNTS AS "NEARLY THE SAME NAME": spacing, punctuation, or a
-- plural. Nothing else.
--
--     R S INDUSTRIES              R.S.INDUSTRIES
--     AUDIT FEE PAYABLE           AUDIT FEES PAYABLE
--     RALSON ( INDIA ) LIMITED.   RALSON (INDIA) LIMITED
--
-- and deliberately NOT these, which are different names and may well be
-- different ledgers on purpose:
--
--     HERO MOTORS LIMITED         HERO MOTORS LIMITED (DADRI)
--     MAGMA BIKES                 MAGMA CYCLES
--     R & D CENTRE FOR BICYCLE..  RESEARCH & DEVELOPMENT CENTRE FOR..
--
-- The last pair is almost certainly one organisation written two ways.
-- A rule loose enough to catch it would also join HERO MOTORS to HERO
-- MOTORS (DADRI), and then the flag would be noise and he would stop
-- reading it. Spelling differences are a judgement; punctuation is not.
-- ============================================================

-- The name with its spacing, punctuation and plurals taken out.
-- Word order is kept: a name is not a bag of words.
create or replace function public.busy_name_key(p_text text)
returns text
language sql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(string_agg(
           case when length(w) > 3 and right(w, 1) = 'S' then left(w, length(w) - 1) else w end,
           ' ' order by ord), '')
  from regexp_split_to_table(
         regexp_replace(upper(coalesce(p_text, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+')
       with ordinality as t(w, ord)
  where w <> '';
$function$;

-- Every ledger in this firm whose name is the same but for spacing,
-- punctuation or a plural. The one asked about is never in its own list.
create or replace function public.busy_similar_ledgers(p_company text, p_ledger text)
returns table(ledger text, entries bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;

  return query
  select h.ledger, count(*) as entries
  from public.busy_history h
  where h.company = p_company
    and h.deleted_at is null
    and h.ledger is not null
    and h.ledger is distinct from p_ledger
    and public.busy_name_key(h.ledger) = public.busy_name_key(p_ledger)
  group by h.ledger
  order by h.ledger;
end;
$function$;

revoke all on function public.busy_name_key(text) from public;
revoke all on function public.busy_similar_ledgers(text, text) from public;
grant execute on function public.busy_name_key(text) to authenticated;
grant execute on function public.busy_similar_ledgers(text, text) to authenticated;
