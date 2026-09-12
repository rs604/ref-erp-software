# Tokyo configuration carried forward — 9 Sep 2026

Not fake data. These are real configuration values from `mamamjohuuacxezcwgqv`,
kept so the Mumbai rebuild starts from the same rules.

## Permission keys in use (27)

| Category | Key | Label |
|---|---|---|
| Masters | `employee_master.view` | View Employee Master |
| Masters | `employee_master.create` | Create Employees |
| Masters | `employee_master.edit` | Edit Employees |
| Masters | `employee_master.delete` | Change Employee Status (Suspend/Mark Left) |
| Masters | `vendor_master.view` | View Vendor Master |
| Masters | `vendor_master.create` | Create Vendors |
| Masters | `vendor_master.edit` | Edit Vendors |
| Masters | `vendor_master.approve` | Approve Vendors |
| Masters | `vendor_master.delete` | Suspend/Blacklist Vendors |
| Km Tracker | `km_tracker.view` | View Km Tracker |
| Km Tracker | `km_tracker.approve` | Approve Km Entries |
| Km Tracker | `km_tracker.edit` | Edit Km Tracker Settings & Payments |
| Inventory & Purchase | `vendor_data_bank.view` | View Vendor Data Bank |
| Inventory & Purchase | `vendor_data_bank.create` | Add Data Bank Contacts |
| Inventory & Purchase | `vendor_data_bank.edit` | Edit Data Bank Contacts |
| HRMS | `holidays.view` | View Holidays |
| HRMS | `holidays.create` | Create Holidays |
| HRMS | `holidays.edit` | Edit Holidays |
| HRMS | `holidays.delete` | Deactivate Holidays |
| HRMS | `loans_advances.view` | View Loans & Advances |
| HRMS | `loans_advances.create` | Create Loans & Advances |
| HRMS | `loans_advances.edit` | Edit Loans & Advances |
| HRMS | `loans_advances.approve` | Approve/Close Loans & Advances |
| HRMS | `payroll.view` | View Salary Calculator |
| HRMS | `payroll.create` | Create Salary Sheet |
| HRMS | `payroll.edit` | Edit Salary Sheet |
| HRMS | `payroll.finalise` | Finalise Salary Sheet |

Shape: `sub_head` + `action` combine into `key`; `category` groups them on the screen.

## app_settings (single row, id = 1)

| Setting | Value | Meaning |
|---|---|---|
| `max_daily_km` | 300 | Km Tracker rejects a day longer than this |
| `session_timeout_minutes` | 480 | Idle logout, 8 hours |
| `esi_wage_ceiling` | 21000 | ESI applies at or below this monthly wage |
| `esi_employee_rate` | 0.75 | Employee ESI %, employer share is separate |
| `pf_applicable_company_wide` | false | PF is off |
| `pf_wage_ceiling` | null | Unset while PF is off |
| `pf_employee_rate` | null | Unset while PF is off |
| `payroll_column_widths` | `{total_earnings:65, advance_deduction:62, incentive_remarks:94}` | Saved salary-sheet grid widths |

## Storage buckets (all private)

`vehicle-km-photos` · `employee-documents` · `vendor-documents` — contents were test images
and were not copied.
