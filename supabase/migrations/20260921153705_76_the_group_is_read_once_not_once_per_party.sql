-- ============================================================
-- 76 THE GROUP IS READ ONCE, NOT ONCE PER PARTY
--
-- busy_balances() picked each party's group with a correlated subquery,
-- so a list of 1,300 ledgers meant 1,300 ordered scans and the whole
-- thing ran past the 8 second budget the `authenticated` role is given.
-- The DISTINCT ON above it had already found the latest row for every
-- ledger; it simply threw the group away and then went and asked again.
--
-- One pass now: keep the group from the row that was already picked.
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
  v_rows jsonb;
  v_out  jsonb;
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

  with grouped as (
    -- A party's group is taken from its most recent row: Busy can move a
    -- ledger between groups and the latest word is the true one. Read
    -- once, here, and carried down rather than asked again per party.
    select ledger from (
      select distinct on (h.ledger) h.ledger, h.ledger_group
      from public.busy_history h
      where h.company = p_company and h.deleted_at is null
        and h.ledger is not null and h.ledger_group is not null
      order by h.ledger, h.vch_date desc nulls last, h.fy desc
    ) latest
    where latest.ledger_group = p_group
  ),
  anchor as (
    select g.ledger, max(public.busy_fy_start(o.fy)) as astart
    from grouped g
    join public.busy_history o
      on o.company = p_company and o.kind = 'opening' and o.deleted_at is null
     and o.ledger = g.ledger and public.busy_fy_start(o.fy) <= p_on
    group by g.ledger
  ),
  op as (
    select a.ledger, sum(coalesce(o.debit,0) - coalesce(o.credit,0)) as v
    from anchor a
    join public.busy_history o
      on o.company = p_company and o.kind = 'opening' and o.deleted_at is null
     and o.ledger = a.ledger and public.busy_fy_start(o.fy) = a.astart
    group by a.ledger
  ),
  mv as (
    select g.ledger,
           sum(coalesce(h.debit,0) - coalesce(h.credit,0)) as v,
           max(h.vch_date) as last_txn,
           count(*) as entries
    from grouped g
    left join anchor a on a.ledger = g.ledger
    join public.busy_history h
      on h.company = p_company and h.kind = 'ledger' and h.deleted_at is null
     and h.ledger = g.ledger and h.vch_date <= p_on
     and (a.astart is null or h.vch_date >= a.astart)
    group by g.ledger
  ),
  bal as (
    select g.ledger as party,
           coalesce(op.v, 0) + coalesce(mv.v, 0) as balance,
           mv.last_txn,
           coalesce(mv.entries, 0)::int as entries
    from grouped g
    left join op on op.ledger = g.ledger
    left join mv on mv.ledger = g.ledger
  )
  select jsonb_agg(to_jsonb(l) order by abs(l.balance) desc) into v_rows
  from (select party, round(balance, 2) as balance,
               case when balance > 0 then 'Dr' else 'Cr' end as side,
               last_txn,
               case when last_txn is null then null
                    else (p_on - last_txn)::int end as days_since,
               entries
        from bal where abs(balance) >= 0.005) l;

  select jsonb_build_object(
    'company',  p_company,
    'group',    p_group,
    'on',       p_on,
    'dr_count', count(*) filter (where (r->>'side') = 'Dr'),
    'dr_total', coalesce(sum((r->>'balance')::numeric) filter (where (r->>'side') = 'Dr'), 0),
    'cr_count', count(*) filter (where (r->>'side') = 'Cr'),
    'cr_total', coalesce(-sum((r->>'balance')::numeric) filter (where (r->>'side') = 'Cr'), 0),
    'rows',     coalesce(v_rows, '[]'::jsonb))
  into v_out
  from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) r;

  return v_out;
end;
$function$;

revoke all on function public.busy_balances(text, text, date) from public;
grant execute on function public.busy_balances(text, text, date) to authenticated;
