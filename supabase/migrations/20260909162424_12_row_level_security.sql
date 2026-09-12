-- ============================================================
-- 12 ROW LEVEL SECURITY
-- Every table is locked by default and opened only by a written rule.
-- All rules go through the SECURITY DEFINER helpers from migration 01,
-- whose search_path is pinned, so a policy can ask "who is this?"
-- without reading the table it is protecting and looping forever.
-- ============================================================

-- Lock every table in public, including any added later by mistake.
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------- Reference lists: everyone signed in may read ----------
do $$
declare t text;
begin
  foreach t in array array[
    'states','cities','branches','departments','designations',
    'employee_categories','relationships','holiday_types','permissions','number_series'
  ]
  loop
    execute format($f$
      create policy %I on public.%I for select to authenticated
        using (public.current_party_id() is not null)
    $f$, t || '_read', t);
  end loop;
end $$;

-- Only HR-level people change the dropdown lists.
do $$
declare t text;
begin
  foreach t in array array[
    'states','cities','branches','departments','designations',
    'employee_categories','relationships','holiday_types'
  ]
  loop
    execute format($f$
      create policy %I on public.%I for insert to authenticated
        with check (public.has_permission('employee_master.edit'))
    $f$, t || '_insert', t);
    execute format($f$
      create policy %I on public.%I for update to authenticated
        using (public.has_permission('employee_master.edit'))
        with check (public.has_permission('employee_master.edit'))
    $f$, t || '_update', t);
  end loop;
end $$;

-- permissions catalogue and number series are owner-only to change
create policy permissions_write on public.permissions for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy number_series_write on public.number_series for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------- The party spine ----------
create policy parties_read on public.parties for select to authenticated
  using (
    id = public.current_party_id()
    or public.has_permission('employee_master.view')
    or public.has_permission('vendor_master.view')
    or public.has_permission('vendor_data_bank.view')
  );

create policy parties_insert on public.parties for insert to authenticated
  with check (
    public.has_permission('employee_master.create')
    or public.has_permission('vendor_master.create')
  );

create policy parties_update on public.parties for update to authenticated
  using (
    public.has_permission('employee_master.edit')
    or public.has_permission('vendor_master.edit')
  )
  with check (
    public.has_permission('employee_master.edit')
    or public.has_permission('vendor_master.edit')
  );

-- child tables of the spine follow the parent
do $$
declare t text;
begin
  foreach t in array array[
    'party_roles','party_addresses','party_contacts',
    'party_family_members','party_education','party_work_experience','employee_assets'
  ]
  loop
    execute format($f$
      create policy %I on public.%I for select to authenticated
        using (
          party_id = public.current_party_id()
          or public.has_permission('employee_master.view')
          or public.has_permission('vendor_master.view')
        )
    $f$, t || '_read', t);

    execute format($f$
      create policy %I on public.%I for insert to authenticated
        with check (
          public.has_permission('employee_master.create')
          or public.has_permission('employee_master.edit')
          or public.has_permission('vendor_master.create')
          or public.has_permission('vendor_master.edit')
        )
    $f$, t || '_insert', t);

    execute format($f$
      create policy %I on public.%I for update to authenticated
        using (
          public.has_permission('employee_master.edit')
          or public.has_permission('vendor_master.edit')
        )
        with check (
          public.has_permission('employee_master.edit')
          or public.has_permission('vendor_master.edit')
        )
    $f$, t || '_update', t);
  end loop;
end $$;

-- Bank details are tighter: your own, or someone who runs payments.
create policy party_bank_accounts_read on public.party_bank_accounts for select to authenticated
  using (
    party_id = public.current_party_id()
    or public.has_permission('payroll.view')
    or public.has_permission('vendor_master.view')
  );
create policy party_bank_accounts_insert on public.party_bank_accounts for insert to authenticated
  with check (public.has_permission('employee_master.edit') or public.has_permission('vendor_master.edit'));
create policy party_bank_accounts_update on public.party_bank_accounts for update to authenticated
  using (public.has_permission('employee_master.edit') or public.has_permission('vendor_master.edit'))
  with check (public.has_permission('employee_master.edit') or public.has_permission('vendor_master.edit'));

-- ---------- Logins and permissions ----------
create policy user_accounts_read on public.user_accounts for select to authenticated
  using (party_id = public.current_party_id() or public.has_permission('admin.users'));
create policy user_accounts_write on public.user_accounts for all to authenticated
  using (public.has_permission('admin.users'))
  with check (public.has_permission('admin.users'));

create policy party_permissions_read on public.party_permissions for select to authenticated
  using (party_id = public.current_party_id() or public.has_permission('admin.permissions'));
create policy party_permissions_write on public.party_permissions for all to authenticated
  using (public.has_permission('admin.permissions'))
  with check (public.has_permission('admin.permissions'));

-- two_step_codes: no client ever touches this. Only the login function,
-- which runs with the service key, may read or write it. No policy = no access.

-- ---------- The logs: readable, never writable from a screen ----------
create policy audit_log_read on public.audit_log for select to authenticated
  using (public.has_permission('admin.audit'));
create policy login_log_read on public.login_log for select to authenticated
  using (public.has_permission('admin.audit') or party_id = public.current_party_id());

create policy events_read on public.events for select to authenticated
  using (
    party_id = public.current_party_id()
    or public.has_permission('admin.audit')
    or public.has_permission('employee_master.view')
    or public.has_permission('vendor_master.view')
  );

-- ---------- Employment ----------
create policy employee_details_read on public.employee_details for select to authenticated
  using (party_id = public.current_party_id() or public.has_permission('employee_master.view'));
create policy employee_details_insert on public.employee_details for insert to authenticated
  with check (public.has_permission('employee_master.create'));
create policy employee_details_update on public.employee_details for update to authenticated
  using (public.has_permission('employee_master.edit'))
  with check (public.has_permission('employee_master.edit'));

create policy salary_records_read on public.salary_records for select to authenticated
  using (party_id = public.current_party_id() or public.has_permission('payroll.view'));
create policy salary_records_insert on public.salary_records for insert to authenticated
  with check (public.has_permission('payroll.edit') or public.has_permission('employee_master.edit'));
create policy salary_records_update on public.salary_records for update to authenticated
  using (public.has_permission('payroll.edit'))
  with check (public.has_permission('payroll.edit'));

create policy holidays_read on public.holidays for select to authenticated
  using (public.current_party_id() is not null);
create policy holidays_insert on public.holidays for insert to authenticated
  with check (public.has_permission('holidays.create'));
create policy holidays_update on public.holidays for update to authenticated
  using (public.has_permission('holidays.edit') or public.has_permission('holidays.delete'))
  with check (public.has_permission('holidays.edit') or public.has_permission('holidays.delete'));

-- ---------- Vendors, customers, items ----------
create policy vendor_details_read on public.vendor_details for select to authenticated
  using (party_id = public.current_party_id() or public.has_permission('vendor_master.view'));
create policy vendor_details_insert on public.vendor_details for insert to authenticated
  with check (public.has_permission('vendor_master.create'));
create policy vendor_details_update on public.vendor_details for update to authenticated
  using (public.has_permission('vendor_master.edit') or public.has_permission('vendor_master.approve')
         or public.has_permission('vendor_master.delete'))
  with check (public.has_permission('vendor_master.edit') or public.has_permission('vendor_master.approve')
         or public.has_permission('vendor_master.delete'));

create policy customer_details_read on public.customer_details for select to authenticated
  using (public.current_party_id() is not null);
create policy customer_details_write on public.customer_details for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy items_read on public.items for select to authenticated
  using (public.current_party_id() is not null);
create policy items_write on public.items for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------- Loans and advances ----------
do $$
declare t text;
begin
  foreach t in array array['employee_loans','employee_advances']
  loop
    execute format($f$
      create policy %I on public.%I for select to authenticated
        using (party_id = public.current_party_id() or public.has_permission('loans_advances.view'))
    $f$, t || '_read', t);
    execute format($f$
      create policy %I on public.%I for insert to authenticated
        with check (public.has_permission('loans_advances.create'))
    $f$, t || '_insert', t);
    execute format($f$
      create policy %I on public.%I for update to authenticated
        using (public.has_permission('loans_advances.edit') or public.has_permission('loans_advances.approve'))
        with check (public.has_permission('loans_advances.edit') or public.has_permission('loans_advances.approve'))
    $f$, t || '_update', t);
  end loop;
end $$;

create policy employee_loan_txn_read on public.employee_loan_transactions for select to authenticated
  using (
    public.has_permission('loans_advances.view')
    or exists (select 1 from public.employee_loans l
               where l.id = loan_id and l.party_id = public.current_party_id())
  );
create policy employee_loan_txn_write on public.employee_loan_transactions for all to authenticated
  using (public.has_permission('loans_advances.edit') or public.has_permission('payroll.finalise'))
  with check (public.has_permission('loans_advances.edit') or public.has_permission('payroll.finalise'));

create policy employee_advance_txn_read on public.employee_advance_transactions for select to authenticated
  using (
    public.has_permission('loans_advances.view')
    or exists (select 1 from public.employee_advances a
               where a.id = advance_id and a.party_id = public.current_party_id())
  );
create policy employee_advance_txn_write on public.employee_advance_transactions for all to authenticated
  using (public.has_permission('loans_advances.edit') or public.has_permission('payroll.finalise'))
  with check (public.has_permission('loans_advances.edit') or public.has_permission('payroll.finalise'));

-- ---------- Payroll ----------
create policy payroll_periods_read on public.payroll_periods for select to authenticated
  using (public.has_permission('payroll.view'));
create policy payroll_periods_insert on public.payroll_periods for insert to authenticated
  with check (public.has_permission('payroll.create'));
create policy payroll_periods_update on public.payroll_periods for update to authenticated
  using (public.has_permission('payroll.edit') or public.has_permission('payroll.finalise'))
  with check (public.has_permission('payroll.edit') or public.has_permission('payroll.finalise'));

create policy payroll_entries_read on public.payroll_entries for select to authenticated
  using (party_id = public.current_party_id() or public.has_permission('payroll.view'));
create policy payroll_entries_insert on public.payroll_entries for insert to authenticated
  with check (public.has_permission('payroll.create'));
create policy payroll_entries_update on public.payroll_entries for update to authenticated
  using (public.has_permission('payroll.edit') or public.has_permission('payroll.finalise'))
  with check (public.has_permission('payroll.edit') or public.has_permission('payroll.finalise'));

-- ---------- Km Tracker ----------
create policy vehicles_read on public.vehicles for select to authenticated
  using (public.current_party_id() is not null);
create policy vehicles_write on public.vehicles for all to authenticated
  using (public.has_permission('km_tracker.edit'))
  with check (public.has_permission('km_tracker.edit'));

create policy daily_entries_read on public.daily_entries for select to authenticated
  using (party_id = public.current_party_id() or public.has_permission('km_tracker.view'));
create policy daily_entries_insert on public.daily_entries for insert to authenticated
  with check (party_id = public.current_party_id() or public.has_permission('km_tracker.edit'));
create policy daily_entries_update on public.daily_entries for update to authenticated
  using (
    (party_id = public.current_party_id() and status = 'draft')
    or public.has_permission('km_tracker.approve')
    or public.has_permission('km_tracker.edit')
  )
  with check (
    party_id = public.current_party_id()
    or public.has_permission('km_tracker.approve')
    or public.has_permission('km_tracker.edit')
  );

create policy payment_batches_read on public.payment_batches for select to authenticated
  using (party_id = public.current_party_id() or public.has_permission('km_tracker.view'));
create policy payment_batches_write on public.payment_batches for all to authenticated
  using (public.has_permission('km_tracker.edit'))
  with check (public.has_permission('km_tracker.edit'));

-- ---------- Files and notes ----------
-- A file is invisible until the virus scan says clean.
create policy attachments_read on public.attachments for select to authenticated
  using (
    scan_status = 'clean'
    and (
      party_id = public.current_party_id()
      or public.has_permission('employee_master.view')
      or public.has_permission('vendor_master.view')
      or public.has_permission('km_tracker.view')
    )
  );
create policy attachments_insert on public.attachments for insert to authenticated
  with check (public.current_party_id() is not null);
create policy attachments_update on public.attachments for update to authenticated
  using (public.has_permission('employee_master.edit') or public.has_permission('vendor_master.edit'))
  with check (public.has_permission('employee_master.edit') or public.has_permission('vendor_master.edit'));

create policy comments_read on public.comments for select to authenticated
  using (public.current_party_id() is not null);
create policy comments_insert on public.comments for insert to authenticated
  with check (public.current_party_id() is not null);
create policy comments_update on public.comments for update to authenticated
  using (party_id = public.current_party_id() or public.is_owner())
  with check (party_id = public.current_party_id() or public.is_owner());

-- ---------- Settings ----------
create policy app_settings_read on public.app_settings for select to authenticated
  using (public.current_party_id() is not null);
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.has_permission('admin.settings'))
  with check (public.has_permission('admin.settings'));
