-- ============================================================
-- 81 THE LEDGER OPENING COMES FROM ITS OWN YEAR
--
-- The same fault as 78, in the other screen. busy_ledger anchored on
-- "the latest opening at or before the range start", which reaches back
-- through dead years until it finds one -- so RAMSONS TYRES, last traded
-- in 2015-16, opened 2026-27 at 50,000.
--
-- Now: the opening is the opening of THE FINANCIAL YEAR CONTAINING THE
-- RANGE START, plus that year's movement up to the start. Nothing from
-- any earlier year. No opening row and no movement means the year opens
-- at nil, because Busy already carried forward everything that was not.
--
-- THE UNDATED COUNT FOLLOWS THE SAME RULE. It counted every undated
-- opening row the party had in any year, which over eleven years is a
-- number about nothing; it is this year's now.
--
-- A RANGE THAT CROSSES 1 APRIL SAYS SO. Busy sets a fresh opening every
-- year, and a running balance carried straight through several years is
-- not the balance Busy shows at each year end. The screen is told, so it
-- can say it rather than quietly presenting one as the other.
-- ============================================================

create or replace function public.busy_ledger(
  p_company text,
  p_party   text,
  p_from    date,
  p_to      date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_fy            text;
  v_fy_start      date;
  v_anchor_amt    numeric := 0;
  v_pre           numeric := 0;
  v_opening       numeric := 0;
  v_has_opening   boolean := false;
  v_rows          jsonb;
  v_debits        numeric := 0;
  v_credits       numeric := 0;
  v_count         bigint  := 0;
  v_undated       bigint  := 0;
  v_cap           constant integer := 5000;
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;
  if p_party is null or btrim(p_party) = '' then
    raise exception 'A party must be named.' using errcode = 'check_violation';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'A date range must have a start and an end, in that order.'
      using errcode = 'check_violation';
  end if;

  -- THE YEAR THE RANGE STARTS IN, and only that year.
  v_fy       := public.busy_fy_of(p_from);
  v_fy_start := public.busy_fy_start(v_fy);

  select coalesce(sum(coalesce(o.debit,0) - coalesce(o.credit,0)), 0), count(*) > 0
    into v_anchor_amt, v_has_opening
  from public.busy_history o
  where o.company = p_company and o.kind = 'opening' and o.deleted_at is null
    and o.ledger = p_party and o.fy = v_fy;

  -- This year's movement before the range starts. Never an earlier year's.
  select coalesce(sum(coalesce(h.debit,0) - coalesce(h.credit,0)), 0)
    into v_pre
  from public.busy_history h
  where h.company = p_company and h.kind = 'ledger' and h.deleted_at is null
    and h.ledger = p_party and h.fy = v_fy
    and h.vch_date < p_from and h.vch_date >= v_fy_start;

  v_opening := coalesce(v_anchor_amt, 0) + v_pre;

  -- This year's undated opening entries. They ARE the opening balance, so
  -- they are counted and named but never listed: listing them would count
  -- the same money twice.
  select count(*) into v_undated
  from public.busy_history h
  where h.company = p_company and h.kind = 'opening' and h.deleted_at is null
    and h.ledger = p_party and h.fy = v_fy;

  with mine as (
    select h.fy, h.vch_code, h.sr_no, h.vch_date, h.doc_type, h.vch_no,
           coalesce(h.debit,0) as debit, coalesce(h.credit,0) as credit
    from public.busy_history h
    where h.company = p_company and h.kind = 'ledger' and h.deleted_at is null
      and h.ledger = p_party
      and h.vch_date >= p_from and h.vch_date <= p_to
    order by h.vch_date, h.fy, h.vch_code, h.sr_no
    limit v_cap
  ),
  other as (
    select m.fy, m.vch_code, m.sr_no,
           string_agg(distinct o.ledger, ', ' order by o.ledger) as particulars
    from mine m
    join public.busy_history o
      on o.company = p_company and o.fy = m.fy and o.vch_code = m.vch_code
     and o.kind = 'ledger' and o.deleted_at is null
     and o.ledger is distinct from p_party
     and coalesce(o.ledger_group,'') not ilike '%Duties%'
     and coalesce(o.ledger,'') not ilike 'Round%'
    group by m.fy, m.vch_code, m.sr_no
  ),
  run as (
    select m.*, ot.particulars,
           v_opening + sum(m.debit - m.credit)
             over (order by m.vch_date, m.fy, m.vch_code, m.sr_no
                   rows between unbounded preceding and current row) as balance
    from mine m
    left join other ot
      on ot.fy = m.fy and ot.vch_code = m.vch_code and ot.sr_no = m.sr_no
  )
  select jsonb_agg(to_jsonb(r) order by r.vch_date, r.fy, r.vch_code, r.sr_no),
         coalesce(sum(r.debit),0), coalesce(sum(r.credit),0), count(*)
    into v_rows, v_debits, v_credits, v_count
  from run r;

  return jsonb_build_object(
    'company',         p_company,
    'party',           p_party,
    'from',            p_from,
    'to',              p_to,
    'opening',         v_opening,
    'debits',          v_debits,
    'credits',         v_credits,
    'closing',         v_opening + v_debits - v_credits,
    'entry_count',     v_count,
    'undated_openings', v_undated,
    'fy',              v_fy,
    'has_opening',     v_has_opening,
    -- A running balance carried straight through several years is not the
    -- balance Busy shows at each year end. Said, not implied.
    'crosses_years',   (public.busy_fy_of(p_to) is distinct from v_fy),
    'capped',          (v_count >= v_cap),
    'rows',            coalesce(v_rows, '[]'::jsonb));
end;
$function$;

revoke all on function public.busy_ledger(text, text, date, date) from public;
grant execute on function public.busy_ledger(text, text, date, date) to authenticated;