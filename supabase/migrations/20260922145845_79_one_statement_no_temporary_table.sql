-- ============================================================
-- 79 ONE STATEMENT, NO TEMPORARY TABLE
--
-- 78 built its answer in a temporary table, which a STABLE function may
-- not create: "CREATE TABLE is not allowed in a non-volatile function".
-- Making the function volatile to suit the shortcut would have been the
-- wrong way round -- it reads and never writes, and saying so is what
-- lets Postgres plan it properly.
--
-- So the whole thing is one statement. The CTE is referenced three
-- times -- the rows with a balance, the nil rows, and the totals -- and
-- the balance is computed once for all three.
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
  v_fy  text;
  v_out jsonb;
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
  -- THIS YEAR'S opening. No reaching back into a dead year.
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
  -- the nil list a call list rather than a list of names.
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
           case when s.last_txn is null then null
                else (p_on - s.last_txn)::int end as days_since,
           coalesce(mv.entries, 0)::int as entries
    from grouped g
    left join op on op.ledger = g.ledger
    left join mv on mv.ledger = g.ledger
    left join seen s on s.ledger = g.ledger
  ),
  sided as (
    select b.*,
           case when b.balance > 0 then 'Dr'
                when b.balance < 0 then 'Cr' else 'Nil' end as side
    from bal b
  ),
  /* SECTION 1, in his order: the side the screen is ABOUT comes first --
     what they owe us on Debtors, what we owe them on Creditors -- and
     biggest first inside each side. */
  live as (
    select jsonb_agg(jsonb_build_object(
             'party', party, 'balance', balance, 'side', side,
             'last_txn', last_txn, 'days_since', days_since, 'entries', entries)
           order by case when p_group = 'Sundry Debtors'
                         then case when side = 'Dr' then 0 else 1 end
                         else case when side = 'Cr' then 0 else 1 end end,
                    abs(balance) desc) as rows
    from sided where side <> 'Nil'
  ),
  /* SECTION 2. Every party in the group, across all years, settled to
     nothing today. Most recently seen first, so the bottom of the list
     is the people who have not been back. */
  nil as (
    select jsonb_agg(jsonb_build_object(
             'party', party, 'last_txn', last_txn, 'days_since', days_since)
           order by last_txn desc nulls last, party) as rows
    from sided where side = 'Nil'
  )
  select jsonb_build_object(
    'company',   p_company,
    'group',     p_group,
    'on',        p_on,
    'fy',        v_fy,
    'dr_count',  count(*) filter (where s.side = 'Dr'),
    'dr_total',  coalesce(sum(s.balance) filter (where s.side = 'Dr'), 0),
    'cr_count',  count(*) filter (where s.side = 'Cr'),
    'cr_total',  coalesce(-sum(s.balance) filter (where s.side = 'Cr'), 0),
    'nil_count', count(*) filter (where s.side = 'Nil'),
    'rows',      coalesce((select rows from live), '[]'::jsonb),
    'nil_rows',  coalesce((select rows from nil), '[]'::jsonb))
  into v_out
  from sided s;

  return v_out;
end;
$function$;

revoke all on function public.busy_balances(text, text, date) from public;
grant execute on function public.busy_balances(text, text, date) to authenticated;