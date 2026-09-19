-- ============================================================
-- 71 TWO SALES OF THE SAME NAME ARE NOT TWO PRICES
--
-- The price history listed every sale that shared an item name. Under
-- SKD CONVEYOR that is eleven sales from 2,00,000 to 26,25,000 -- an
-- extension, a drive unit and a complete assembly line, shown in a row
-- as though they were one machine getting dearer. It does not look
-- wrong, which is the worst thing a pricing screen can be.
--
-- So a sale is comparable to another only when the ITEM NAME matches
-- (it already did) AND THE DESCRIPTION MEANS THE SAME THING, under the
-- rule already locked for search everywhere in this ERP:
--
--     FUZZY ON WORDS, EXACT ON NUMBERS.
--
-- '130 FEET LENGTH' and '130 FEET' are one machine. '130 FEET' and
-- '38 FEET' are not, and no amount of fuzziness may make them so:
-- busy_numbers() must come back identical before anything else is
-- looked at. That is busy_near()'s own rule -- it refuses any string
-- containing a digit -- raised to the whole description.
--
-- BLANK MATCHES ONLY BLANK. 1,886 of 3,842 sale lines carry no
-- description at all. If blank matched everything, the fault this
-- migration fixes would come straight back through the emptiest rows.
--
-- WORDS: every word of the SHORTER description must have a partner in
-- the longer one -- equal, or near it by busy_near. That is what makes
-- 'LENGTH' harmless in '130 FEET LENGTH'. It also means the longer
-- description may carry words the shorter one does not, so the screen
-- PRINTS EVERY MATCHED DESCRIPTION rather than asserting a match. He
-- can see what was compared instead of trusting it. A stop-word list
-- ('LENGTH', 'SIZE', 'WITH'...) would be the stricter rule, and it
-- would be a dictionary invented here and wrong the first time a new
-- word turned up.
-- ============================================================

-- The letters of a description, one word each. Digits are the numbers'
-- business, not the words' -- '6MM' is the word MM and the number 6, so
-- '6MM' and '6 MM' are the same thing written twice.
create or replace function public.busy_desc_words(p_text text)
returns text[]
language sql
immutable
parallel safe
as $function$
  select coalesce(array_agg(m[1] order by m[1]), '{}'::text[])
  from regexp_matches(upper(coalesce(p_text, '')), '([A-Z]+)', 'g') m;
$function$;

-- Do these two descriptions mean the same machine?
create or replace function public.busy_comparable(p_a text, p_b text)
returns boolean
language plpgsql
immutable
parallel safe
as $function$
declare
  a     text := btrim(coalesce(p_a, ''));
  b     text := btrim(coalesce(p_b, ''));
  aw    text[];
  bw    text[];
  shortw text[];
  longw  text[];
begin
  -- Blank matches only blank. Blank does not match everything.
  if a = '' or b = '' then
    return a = '' and b = '';
  end if;

  -- EXACT ON NUMBERS, before anything else is considered.
  if public.busy_numbers(a) is distinct from public.busy_numbers(b) then
    return false;
  end if;

  aw := public.busy_desc_words(a);
  bw := public.busy_desc_words(b);

  if coalesce(array_length(aw, 1), 0) <= coalesce(array_length(bw, 1), 0)
    then shortw := aw; longw := bw;
    else shortw := bw; longw := aw;
  end if;

  -- FUZZY ON WORDS: nothing in the shorter description may be unaccounted for.
  return not exists (
    select 1
    from unnest(shortw) s
    where not exists (
      select 1
      from unnest(longw) l
      where l = s or public.busy_near(s, l) or public.busy_near(l, s)));
end;
$function$;

-- What this machine was charged at before. Its own row per sale, never
-- averaged, and now only the sales that are the same machine.
--
-- p_match_desc = false is the "check another item at that time" box at
-- the bottom of the panel, where there is no sale in hand to compare
-- against and every priced sale is what is wanted.
drop function if exists public.busy_item_price_history(text, text);

create or replace function public.busy_item_price_history(
  p_company     text,
  p_item        text,
  p_desc        text    default null,
  p_match_desc  boolean default false)
returns table(vch_date date, party text, description text,
              qty numeric, rate numeric, amount numeric, is_lump_sum boolean)
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
  select h.vch_date, h.party, h.description, h.qty, h.rate, h.amount,
         coalesce(h.is_lump_sum, false)
  from public.busy_history h
  where h.company = p_company and h.kind = 'item' and h.deleted_at is null
    and h.doc_type = 'Sales Invoice' and h.item = p_item
    and (not coalesce(p_match_desc, false)
         or public.busy_comparable(h.description, p_desc))
  order by h.vch_date asc
  limit 200;
end;
$function$;

revoke all on function public.busy_desc_words(text) from public;
revoke all on function public.busy_comparable(text, text) from public;
revoke all on function public.busy_item_price_history(text, text, text, boolean) from public;
grant execute on function public.busy_desc_words(text) to authenticated;
grant execute on function public.busy_comparable(text, text) to authenticated;
grant execute on function public.busy_item_price_history(text, text, text, boolean) to authenticated;
