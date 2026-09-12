insert into public.app_settings (id, max_daily_km, session_timeout_minutes,
  esi_wage_ceiling, esi_employee_rate, esi_employer_rate,
  pf_applicable_company_wide, payroll_column_widths, status)
values (1, 300, 480, 21000, 0.75, 3.25, false,
  '{"total_earnings":65,"advance_deduction":62,"incentive_remarks":94}'::jsonb, 'approved');

insert into public.number_series (series_key, prefix, pad_width, include_year, description, status) values
  ('employee',        'EMP', 4, false, 'Employee number',            'approved'),
  ('vendor',          'VEN', 4, false, 'Vendor number',              'approved'),
  ('customer',        'CUS', 4, false, 'Customer number',            'approved'),
  ('party',           'PTY', 5, false, 'Any other party',            'approved'),
  ('item',            'ITM', 5, false, 'Item code',                  'approved'),
  ('loan',            'LON', 4, true,  'Employee loan',              'approved'),
  ('advance',         'ADV', 4, true,  'Employee advance',           'approved'),
  ('payroll_period',  'SAL', 2, true,  'Monthly salary sheet',       'approved'),
  ('payment_batch',   'KMP', 4, true,  'Km Tracker payment batch',   'approved');

insert into public.permissions (key, sub_head, action, label, category, sort_order, status) values
  ('employee_master.view',   'employee_master', 'view',    'View Employee Master',                       'Masters', 10, 'approved'),
  ('employee_master.create', 'employee_master', 'create',  'Create Employees',                           'Masters', 11, 'approved'),
  ('employee_master.edit',   'employee_master', 'edit',    'Edit Employees',                             'Masters', 12, 'approved'),
  ('employee_master.delete', 'employee_master', 'delete',  'Change Employee Status (Suspend/Mark Left)', 'Masters', 13, 'approved'),

  ('vendor_master.view',     'vendor_master',   'view',    'View Vendor Master',                         'Masters', 20, 'approved'),
  ('vendor_master.create',   'vendor_master',   'create',  'Create Vendors',                             'Masters', 21, 'approved'),
  ('vendor_master.edit',     'vendor_master',   'edit',    'Edit Vendors',                               'Masters', 22, 'approved'),
  ('vendor_master.approve',  'vendor_master',   'approve', 'Approve Vendors',                            'Masters', 23, 'approved'),
  ('vendor_master.delete',   'vendor_master',   'delete',  'Suspend/Blacklist Vendors',                  'Masters', 24, 'approved'),

  ('km_tracker.view',        'km_tracker',      'view',    'View Km Tracker',                            'Km Tracker', 30, 'approved'),
  ('km_tracker.approve',     'km_tracker',      'approve', 'Approve Km Entries',                         'Km Tracker', 31, 'approved'),
  ('km_tracker.edit',        'km_tracker',      'edit',    'Edit Km Tracker Settings & Payments',        'Km Tracker', 32, 'approved'),

  ('vendor_data_bank.view',  'vendor_data_bank','view',    'View Vendor Data Bank',                      'Inventory & Purchase', 40, 'approved'),
  ('vendor_data_bank.create','vendor_data_bank','create',  'Add Data Bank Contacts',                     'Inventory & Purchase', 41, 'approved'),
  ('vendor_data_bank.edit',  'vendor_data_bank','edit',    'Edit Data Bank Contacts',                    'Inventory & Purchase', 42, 'approved'),

  ('holidays.view',          'holidays',        'view',    'View Holidays',                              'HRMS', 50, 'approved'),
  ('holidays.create',        'holidays',        'create',  'Create Holidays',                            'HRMS', 51, 'approved'),
  ('holidays.edit',          'holidays',        'edit',    'Edit Holidays',                              'HRMS', 52, 'approved'),
  ('holidays.delete',        'holidays',        'delete',  'Deactivate Holidays',                        'HRMS', 53, 'approved'),

  ('loans_advances.view',    'loans_advances',  'view',    'View Loans & Advances',                      'HRMS', 60, 'approved'),
  ('loans_advances.create',  'loans_advances',  'create',  'Create Loans & Advances',                    'HRMS', 61, 'approved'),
  ('loans_advances.edit',    'loans_advances',  'edit',    'Edit Loans & Advances',                      'HRMS', 62, 'approved'),
  ('loans_advances.approve', 'loans_advances',  'approve', 'Approve/Close Loans & Advances',             'HRMS', 63, 'approved'),

  ('payroll.view',           'payroll',         'view',    'View Salary Calculator',                     'HRMS', 70, 'approved'),
  ('payroll.create',         'payroll',         'create',  'Create Salary Sheet',                        'HRMS', 71, 'approved'),
  ('payroll.edit',           'payroll',         'edit',    'Edit Salary Sheet',                          'HRMS', 72, 'approved'),
  ('payroll.finalise',       'payroll',         'approve', 'Finalise Salary Sheet',                      'HRMS', 73, 'approved'),

  ('admin.users',            'admin',           'edit',    'Manage Logins & Two-Step',                   'Admin', 80, 'approved'),
  ('admin.permissions',      'admin',           'edit',    'Grant & Revoke Permissions',                 'Admin', 81, 'approved'),
  ('admin.audit',            'admin',           'view',    'View Audit Trail & Login History',           'Admin', 82, 'approved'),
  ('admin.settings',         'admin',           'edit',    'Change Company Settings',                    'Admin', 83, 'approved');
