-- ============================================================
-- 65 THE PARTY LEDGER
--
-- THE KEY IS `ledger`, NOT `party`. This is the whole trap of this
-- screen and it is worth spelling out, because the wrong one looks
-- right until you add it up.
--
-- busy_history keeps EVERY line of a voucher. A sales invoice to Hindon
-- is four rows: Hindon, Sales, CGST, SGST. The `party` column carries
-- the voucher's party on all four. So summing debit-credit over
-- party='HINDON...' sums a voucher against itself and comes to exactly
-- zero -- which is what it did, on 17 rows, and zero is a number that
-- looks like an answer.
--
-- Worse, `party` is not even the party on a receipt: payments and
-- receipts carry the BANK there (8 distinct values across 18,040 rows).
-- The party's own line is the one where ledger = the party's name.
--
-- Checked against Busy's own figures, REF 2025-26, to the rupee:
--   HINDON METAFORMS     -483,537 + 524,787   =    41,250
--   JUNEJA STEEL SALES  4,031,821 - 1,399,280 = 2,632,541
--   T I CYCLES OF INDIA   870,000 -   870,000 =         0
-- and each one's closing equals the NEXT year's opening row in Busy,
-- which is the check that the arithmetic is Busy's and not mine.
--
-- OPENING AT AN ARBITRARY DATE. Busy gives an opening balance per
-- financial year, undated. For a range starting on 1 April that row IS
-- the opening. For any other start -- this month, a picked date -- the
-- opening is that row plus everything that moved between 1 April and
-- the range start. Both give the same answer on 1 April, so there is
-- one rule and not two.
--
-- If a year's opening row is missing (a file that never came), the
-- anchor rolls back to the last year Busy did give us and the movement
-- since is added. The screen is told which year it anchored on, so a
-- missing year is visible rather than silently read as nil.
--
-- SIGN. debit - credit, throughout. Positive is Dr and RECEIVABLE,
-- negative is Cr and PAYABLE. An overpaid supplier therefore flips to
-- Receivable by itself, which is the right answer and needs no special
-- case.
-- ============================================================

-- The ledger screen reads one party across a date range. The existing
-- ledger index carries vch_type, which this never filters on, so it
-- cannot help with the range.
create index if not exists busy_history_party_ledger_idx
  on public.busy_history (company, ledger, vch_date)
  where kind = 'ledger' and deleted_at is null;

create index if not exists busy_history_opening_idx
  on public.busy_history (company, ledger, fy)
  where kind = 'opening' and deleted_at is null;

-- A financial year as Busy writes it -- '2025-26' -- starts on 1 April
-- of its first half.
create or replace function public.busy_fy_start(p_fy text)
returns date
language sql
immutable
as $function$
  select case when p_fy ~ '^\d{4}-\d{2}$'
              then make_date(split_part(p_fy, '-', 1)::int, 4, 1)
         end;
$function$;


-- ---------- who you can pick ----------
create or replace function public.busy_party_list(
  p_company text,
  p_query   text default null,
  p_limit   integer default 50)
returns table(ledger text, ledger_group text, entries bigint, last_entry date)
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
  select h.ledger, min(h.ledger_group), count(*), max(h.vch_date)
  from public.busy_history h
  where h.company = p_company
    and h.kind in ('ledger','opening')
    and h.deleted_at is null
    and h.ledger is not null
    and (h.ledger_group ilike '%Debtor%' or h.ledger_group ilike '%Creditor%')
    and (p_query is null or p_query = ''
         or h.ledger ilike '%' || p_query || '%')
  group by h.ledger
  order by h.ledger
  limit greatest(1, least(coalesce(p_limit, 50), 500));
end;
$function$;


-- ---------- the ledger itself ----------
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
  v_anchor_fy     text;
  v_anchor_start  date;
  v_anchor_amt    numeric := 0;
  v_pre           numeric := 0;
  v_opening       numeric := 0;
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

  -- The latest year Busy gave us an opening for, at or before the range
  -- start. Usually the range's own year; the previous one when a file is
  -- missing.
  select o.fy, public.busy_fy_start(o.fy), sum(coalesce(o.debit,0) - coalesce(o.credit,0))
    into v_anchor_fy, v_anchor_start, v_anchor_amt
  from public.busy_history o
  where o.company = p_company and o.kind = 'opening' and o.deleted_at is null
    and o.ledger = p_party
    and public.busy_fy_start(o.fy) is not null
    and public.busy_fy_start(o.fy) <= p_from
  group by o.fy
  order by public.busy_fy_start(o.fy) desc
  limit 1;

  -- Everything that moved between the anchor and the range start. With
  -- no anchor at all, that is everything before the range start, which
  -- is the same rule read from zero.
  select coalesce(sum(coalesce(h.debit,0) - coalesce(h.credit,0)), 0)
    into v_pre
  from public.busy_history h
  where h.company = p_company and h.kind = 'ledger' and h.deleted_at is null
    and h.ledger = p_party
    and h.vch_date < p_from
    and (v_anchor_start is null or h.vch_date >= v_anchor_start);

  v_opening := coalesce(v_anchor_amt, 0) + v_pre;

  -- Busy's undated opening entries for this party. They are NOT listed
  -- as entries -- they are the opening balance, and listing them would
  -- count the same money twice -- but the screen says how many there are
  -- rather than dropping them in silence.
  select count(*) into v_undated
  from public.busy_history h
  where h.company = p_company and h.kind = 'opening' and h.deleted_at is null
    and h.ledger = p_party;

  -- The entries, oldest first, with the balance running through them.
  -- Particulars is the other side of the voucher: what the money was
  -- for, or which bank it came from. Tax and round-off lines are left
  -- out of that phrase -- they are on every invoice and say nothing.
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
    'anchor_fy',       v_anchor_fy,
    'capped',          (v_count >= v_cap),
    'rows',            coalesce(v_rows, '[]'::jsonb));
end;
$function$;

revoke all on function public.busy_party_list(text, text, integer) from public;
revoke all on function public.busy_ledger(text, text, date, date) from public;
grant execute on function public.busy_party_list(text, text, integer) to authenticated;
grant execute on function public.busy_ledger(text, text, date, date) to authenticated;
