-- ============================================================
-- 77 ONE CUSTOMER, TWO LEDGERS, ON EVERY LIST
--
-- AKSON INDUSTRIES nets to zero. AKSON INDUSTRIES PVT LTD holds a
-- 9,97,050 advance. Anyone reading only the first would say Akson owes
-- nothing and has paid nothing.
--
-- The old key (migration 72) took out spacing, punctuation and plurals,
-- and deliberately went no further. It does not join these two: PVT LTD
-- is a word, not a punctuation mark. So the rule is widened by exactly
-- one thing -- THE WORDS THAT SAY WHAT KIND OF COMPANY IT IS:
--
--     PVT · PRIVATE · LTD · LIMITED · CO · COMPANY · CORP ·
--     CORPORATION · INC · LLP · AND
--
-- Measured on the real data before it was written. 20 groups across both
-- firms, every one of them a genuine pair, and five the old rule missed:
--
--     AKSON INDUSTRIES          AKSON INDUSTRIES PVT LTD
--     ARK ENGINEERING PRIVATE LIMITED   ARK ENGINEERING PVT LTD.
--     FAIRDEAL AGENCIES         FAIRDEAL AGENCIES PVT LTD.
--     GOEL SALES CORP.          GOEL SALES CORPORATION
--     POOJA INDUSTRIES PRIVATE LIMITED  POOJA INDUSTRIES PVT.LTD
--     RALSON ( INDIA ) LIMITED. · RALSON (INDIA) LIMITED ·
--                                 RALSON INDIA PVT. LIMITED
--
-- and it still does NOT join HERO MOTORS LIMITED to HERO MOTORS LIMITED
-- (DADRI), because DADRI is a place, not a company form. That line is
-- the whole reason the list stays worth reading.
--
-- TWO THINGS THE TRIAL RUN CAUGHT, both of them the rule eating letters
-- that carry meaning:
--   'S' as a stop word turned R S INDUSTRIES into R INDUSTRIE and
--       J S ENGINEERS into J ENGINEER. Initials are not company forms.
--   stripping a trailing S turned UNICROSS into UNICROS. A word ending
--       SS is not a plural.
-- ============================================================

-- The name with its spacing, punctuation, plurals AND company form taken
-- out. Word order is kept: a name is not a bag of words.
create or replace function public.busy_core_name(p_text text)
returns text
language sql
immutable
parallel safe
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(string_agg(
           case when length(w) > 3 and right(w, 1) = 'S' and right(w, 2) <> 'SS'
                then left(w, length(w) - 1) else w end,
           ' ' order by ord), '')
  from regexp_split_to_table(
         regexp_replace(upper(coalesce(p_text, '')), '[^A-Z0-9]+', ' ', 'g'), '\s+')
       with ordinality as t(w, ord)
  where w <> ''
    and w not in ('PVT','PRIVATE','LTD','LIMITED','CO','COMPANY',
                  'CORP','CORPORATION','INC','LLP','AND');
$function$;

-- Every ledger in this firm whose name means the same as the one asked
-- about. The one asked about is never in its own list, and it must be a
-- ledger Busy actually holds (migration 73: a note that fires on a name
-- nobody has is worse than no note).
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

  if not exists (
    select 1 from public.busy_history h
    where h.company = p_company and h.deleted_at is null and h.ledger = p_ledger)
  then
    return;
  end if;

  return query
  select h.ledger, count(*) as entries
  from public.busy_history h
  where h.company = p_company
    and h.deleted_at is null
    and h.ledger is not null
    and h.ledger is distinct from p_ledger
    and public.busy_core_name(h.ledger) = public.busy_core_name(p_ledger)
  group by h.ledger
  order by h.ledger;
end;
$function$;

-- EVERY group of near-identical names in this firm, in ONE call. A list
-- screen has hundreds of rows and cannot ask per row; it asks once and
-- marks what it already holds.
create or replace function public.busy_similar_groups(p_company text)
returns table(core text, names text[], how_many int)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  with names as (
    select distinct h.ledger as name
    from public.busy_history h
    where h.company = p_company and h.deleted_at is null and h.ledger is not null
  ),
  keyed as (
    select public.busy_core_name(n.name) as core, n.name from names n
  )
  select k.core, array_agg(k.name order by k.name)::text[], count(*)::int
  from keyed k
  where k.core <> ''
  group by k.core
  having count(*) > 1
  order by k.core;
end;
$function$;

revoke all on function public.busy_core_name(text) from public;
revoke all on function public.busy_similar_groups(text) from public;
grant execute on function public.busy_core_name(text) to authenticated;
grant execute on function public.busy_similar_groups(text) to authenticated;
