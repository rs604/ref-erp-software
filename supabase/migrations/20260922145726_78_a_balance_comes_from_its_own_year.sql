-- ============================================================
-- 78 A BALANCE COMES FROM ITS OWN YEAR
--
-- "Ramson -- we have not done any business, still it shows 50,000."
--
-- RAMSONS TYRES last traded in 2015-16. The 50,000 is an advance from
-- March 2016 sitting on the OLD SPELLING of the name; when the ledger
-- was renamed RAMSON TYRES, Busy carried the 50,000 forward as the new
-- ledger's opening and the new ledger closed at zero. The old one was
-- never touched again.
--
-- The rule underneath busy_ledger and busy_balances was "the latest
-- opening at or before the date", which reaches back through dead years
-- until it finds one -- and found March 2016. Six parties came back
-- from the dead that way:
--
--     RAMSONS TYRES      50,000   last active 2015-16
--     GOEL SALES CORP.   16,939   last active 2023-24
--     GLOBIZ TECHNOLOGY  13,500   last active 2018-19
--     RALSON INDIA        7,488   last active 2015-16
--     KAMAKHYA SOFT       5,000   last active 2017-18
--     ARK ENGINEERINGH    1,770   last active 2023-24
--
-- THE RULE NOW: a balance at a date comes ONLY from the financial year
-- containing that date -- that year's opening plus that year's movement
-- up to the date. Nothing from any earlier year. A party with neither
-- is NIL, because Busy already carried forward everything that was not
-- zero. Measured: REF has 80 parties with a balance, not 86, and the
-- four totals then match his to the rupee.
--
-- AND THE NIL PARTIES ARE A LIST, NOT AN ABSENCE. Every party in the
-- group across ALL years whose balance today is nil: fully settled, and
-- sorted by last transaction it is the dormant-customer call list. It
-- answers "have we done business with them?" -- Ramson appears here as
-- NIL, last seen 2016, which is the truth.
--
-- A party is never in both. A balance of 1 rupee is a balance.
-- ============================================================

create or replace function public.busy_balances(
  p_company text,
  p_group   text,                       -- 'Sundry Debtors' or 'Sundry Creditors'
  p_on      date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_fy    text;
  v_rows  jsonb;
  v_nil   jsonb;
  v_out   jsonb;
begin
  if not (public.has_permission('busy_data.view') or public.is_owner()) then
    raise exception 'You do not have permission to see Busy data.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_company is null or p_company not in ('REF','RS') then
    raise exception 'A company must be named, and it must be REF or RS.'
      using errcode = 'check_violation';
  end if;
  if p_group is null or p_group not in ('Sundry Debtors','Sundry Creditors') then
    raise exception 'The group must be Sundry Debtors or Sundry Creditors.'
      using errcode = 'check_violation';
  end if;

  v_fy := public.busy_fy_of(p_on);

  create temporary table if not exists _bal_tmp (
    party text, balance numeric, side text, last_txn date, days_since int, entries int
  ) on commit drop;

  with grouped as (
    -- A party's group is its most recent row's group, read once.
    select ledger from (
      select distinct on (h.ledger) h.ledger, h.ledger_group
      from public.busy_history h
      where h.company = p_company and h.deleted_at is null
        and h.ledger is not null and h.ledger_group is not null
      order by h.ledger, h.vch_date desc nulls last, h.fy desc
    ) latest
    where latest.ledger_group = p_group
  ),
  -- THIS YEAR'S opening. No reaching back.
  op as (
    select h.ledger, sum(coalesce(h.debit,0) - coalesce(h.credit,0)) as v
    from public.busy_history h
    where h.company = p_company and h.kind = 'opening' and h.deleted_at is null
      and h.fy = v_fy
    group by h.ledger
  ),
  -- THIS YEAR'S movement, up to the date.
  mv as (
    select h.ledger, sum(coalesce(h.debit,0) - coalesce(h.credit,0)) as v,
           count(*) as entries
    from public.busy_history h
    where h.company = p_company and h.kind = 'ledger' and h.deleted_at is null
      and h.fy = v_fy and h.vch_date <= p_on
    group by h.ledger
  ),
  -- The last time anything happened at all, across EVERY year: what makes
  -- the nil list a call list.
  seen as (
    select h.ledger, max(h.vch_date) as last_txn
    from public.busy_history h
    where h.company = p_company and h.kind = 'ledger' and h.deleted_at is null
      and h.vch_date <= p_on
    group by h.ledger
  ),
  bal as (
    select g.ledger as party,
           round(coalesce(op.v, 0) + coalesce(mv.v, 0), 2) as balance,
           s.last_txn,
           coalesce(mv.entries, 0)::int as entries
    from grouped g
    left join op on op.ledger = g.ledger
    left join mv on mv.ledger = g.ledger
    left join seen s on s.ledger = g.ledger
  )
  insert into _bal_tmp
  select party, balance,
         case when balance > 0 then 'Dr' when balance < 0 then 'Cr' else 'Nil' end,
         last_txn,
         case when last_txn is null then null else (p_on - last_txn)::int end,
         entries
  from bal;

  /* SECTION 1, in his order. The side the screen is ABOUT comes first --
     what they owe us on Debtors, what we owe them on Creditors -- and
     biggest first inside each side. */
  select jsonb_agg(to_jsonb(r) order by
           case when p_group = 'Sundry Debtors'
                then case when r.side = 'Dr' then 0 else 1 end
                else case when r.side = 'Cr' then 0 else 1 end end,
           abs(r.balance) desc)
    into v_rows
  from (select * from _bal_tmp where side <> 'Nil') r;

  /* SECTION 2. Every party in the group, across all years, settled to
     nothing today. Most recently seen first, so the bottom of the list
     is the people who have not been back. */
  select jsonb_agg(to_jsonb(n) order by n.last_txn desc nulls last, n.party)
    into v_nil
  from (select party, last_txn, days_since from _bal_tmp where side = 'Nil') n;

  select jsonb_build_object(
    'company',   p_company,
    'group',     p_group,
    'on',        p_on,
    'fy',        v_fy,
    'dr_count',  count(*) filter (where side = 'Dr'),
    'dr_total',  coalesce(sum(balance) filter (where side = 'Dr'), 0),
    'cr_count',  count(*) filter (where side = 'Cr'),
    'cr_total',  coalesce(-sum(balance) filter (where side = 'Cr'), 0),
    'nil_count', count(*) filter (where side = 'Nil'),
    'rows',      coalesce(v_rows, '[]'::jsonb),
    'nil_rows',  coalesce(v_nil, '[]'::jsonb))
  into v_out
  from _bal_tmp;

  drop table if exists _bal_tmp;
  return v_out;
end;
$function$;

revoke all on function public.busy_balances(text, text, date) from public;
grant execute on function public.busy_balances(text, text, date) to authenticated;