-- ============================================================================
-- SCHEMA-ONLY SNAPSHOT  ("public" schema)
-- ============================================================================
-- Project ref   : mamamjohuuacxezcwgqv
-- Project name  : vehicle-km-tracker
-- Region        : ap-northeast-1 (Tokyo)
-- Export date   : 2026-09-09
--
-- THIS IS A STRUCTURE-ONLY EXPORT. It contains NO table rows.
-- It was taken BEFORE the project was migrated to Mumbai (ap-south-1),
-- so it is the last faithful record of the Tokyo-region database layout.
--
-- Contents (in order):
--   1. Extensions
--   2. Custom types / enums          -- (none exist in this database)
--   3. Sequences not owned by a column
--   4. Tables
--   5. Constraints (PK / UNIQUE / CHECK / FK)
--   6. Indexes (non-constraint-backing)
--   7. Functions & procedures        -- (none exist in schema public)
--   8. Triggers                      -- (none exist in schema public)
--   9. Views / materialized views    -- (none exist in schema public)
--  10. Row Level Security
--  11. Storage buckets               -- documentation comment only
--  12. Live row counts               -- documentation comment only
-- ============================================================================

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET row_security = off;
SET search_path = public, extensions, pg_catalog;


-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
-- Installed outside pg_catalog / information_schema. Supabase creates the
-- "extensions" and "vault" schemas itself; they are assumed to already exist.

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;  -- 1.11
CREATE EXTENSION IF NOT EXISTS "pgcrypto"           WITH SCHEMA extensions;  -- 1.3
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"          WITH SCHEMA extensions;  -- 1.1
CREATE EXTENSION IF NOT EXISTS "supabase_vault"     WITH SCHEMA vault;       -- 0.3.1


-- ============================================================================
-- 2. CUSTOM TYPES / ENUMS
-- ============================================================================
-- None. pg_type + pg_enum returned zero rows for schema "public".
-- Every constrained value in this database is modelled as a `text` column
-- with a CHECK ( ... = ANY (ARRAY[...]) ) constraint (see section 5).


-- ============================================================================
-- 3. SEQUENCES NOT OWNED BY A COLUMN
-- ============================================================================
-- vendor_code_seq is a standalone sequence (no OWNED BY dependency). It is
-- consumed by the DEFAULT on public.vendors.vendor_code, which formats it as
-- 'VEN-0001', 'VEN-0002', ...  It must be created BEFORE public.vendors.
-- Last value in the Tokyo database at export time: 26.

CREATE SEQUENCE public.vendor_code_seq
    AS bigint
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    NO MAXVALUE
    CACHE 1
    NO CYCLE;


-- ============================================================================
-- 4. TABLES
-- ============================================================================

CREATE TABLE public.app_settings (
    id integer DEFAULT 1 NOT NULL,
    max_daily_km numeric(10,2) DEFAULT 300 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    session_timeout_minutes integer DEFAULT 480 NOT NULL,
    esi_wage_ceiling numeric(12,2) DEFAULT 21000 NOT NULL,
    esi_employee_rate numeric(6,4) DEFAULT 0.75 NOT NULL,
    pf_applicable_company_wide boolean DEFAULT false NOT NULL,
    pf_wage_ceiling numeric(12,2),
    pf_employee_rate numeric(6,4),
    payroll_column_widths jsonb
);

CREATE TABLE public.asset_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    state_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.daily_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    vehicle_id uuid NOT NULL,
    entry_date date NOT NULL,
    morning_reading numeric(10,2),
    morning_photo_url text,
    morning_location_text text,
    morning_lat numeric(10,6),
    morning_lng numeric(10,6),
    morning_timestamp timestamp with time zone,
    evening_reading numeric(10,2),
    evening_photo_url text,
    evening_location_text text,
    evening_lat numeric(10,6),
    evening_lng numeric(10,6),
    evening_timestamp timestamp with time zone,
    km_traveled numeric(10,2),
    rate_applied numeric(10,2),
    cost numeric(10,2),
    status text DEFAULT 'pending_evening'::text NOT NULL,
    photos_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    morning_photo_missing boolean DEFAULT false NOT NULL,
    evening_photo_missing boolean DEFAULT false NOT NULL,
    rejection_reason text,
    rejected_by uuid,
    rejected_at timestamp with time zone,
    payment_batch_id uuid
);

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.designations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.employee_advances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    advance_date date NOT NULL,
    payroll_period text NOT NULL,
    recovered_amount numeric(12,2) DEFAULT 0 NOT NULL,
    carried_forward boolean DEFAULT false NOT NULL,
    status text DEFAULT 'outstanding'::text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    recovered_in_period_id uuid
);

CREATE TABLE public.employee_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    asset_type_id uuid,
    asset_details text,
    given_date date,
    returned_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.employee_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.employee_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    document_name text,
    file_url text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    slot text
);

CREATE TABLE public.employee_education (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    qualification text,
    institute_name text,
    board_university text,
    passing_year text,
    percentage text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.employee_family_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    member_name text,
    relationship_id uuid,
    age integer,
    is_dependent boolean,
    occupation text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.employee_loan_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid NOT NULL,
    txn_date date NOT NULL,
    amount numeric(12,2) NOT NULL,
    txn_type text DEFAULT 'deduction'::text NOT NULL,
    payroll_period text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payroll_period_id uuid
);

CREATE TABLE public.employee_loans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    ledger_type text NOT NULL,
    principal_amount numeric(12,2) NOT NULL,
    disbursed_on date NOT NULL,
    monthly_deduction numeric(12,2),
    total_installments integer,
    reason text,
    status text DEFAULT 'active'::text NOT NULL,
    closed_on date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.employee_nominees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    name text,
    relation text,
    dob_or_age text,
    address text,
    mobile text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.employee_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.employee_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address text,
    user_agent text
);

CREATE TABLE public.employee_work_experience (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    company_name text,
    duration text,
    "position" text,
    reason_for_leaving text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    mobile_number text NOT NULL,
    pin text NOT NULL,
    role text DEFAULT 'employee'::text NOT NULL,
    rate_per_km numeric(10,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text,
    assigned_vehicle_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    employee_code text,
    branch_id uuid,
    department_id uuid,
    designation_id uuid,
    employee_category_id uuid,
    date_of_joining date,
    wage_type text DEFAULT 'Monthly'::text,
    photo_url text,
    father_husband_name text,
    marital_status text,
    religion text,
    gender text,
    date_of_birth date,
    place_of_birth text,
    aadhar_no text,
    blood_group text,
    present_address text,
    present_city_id uuid,
    present_state_id uuid,
    present_pincode text,
    permanent_address text,
    permanent_city_id uuid,
    permanent_state_id uuid,
    permanent_pincode text,
    tel_home text,
    emergency_contact_name text,
    emergency_contact_relation text,
    emergency_contact_address text,
    emergency_contact_city_id uuid,
    emergency_contact_state_id uuid,
    emergency_contact_pincode text,
    emergency_contact_mobile text,
    has_disease boolean,
    has_criminal_record boolean,
    bank_name text,
    bank_account_number text,
    bank_ifsc text,
    bank_branch text,
    bank_account_holder_name text,
    pan_number text,
    pf_applicable boolean DEFAULT false NOT NULL,
    pf_number text,
    esi_applicable boolean DEFAULT false NOT NULL,
    esi_number text,
    uan_number text,
    driving_license_number text,
    driving_license_category text,
    driving_license_validity date,
    vehicle_km_applicable boolean DEFAULT false NOT NULL,
    has_ref_employee boolean,
    ref_employee_name text,
    ref_employee_contact text,
    father_husband_relation text,
    salary_basic numeric(10,2),
    salary_hra numeric(10,2),
    salary_da numeric(10,2),
    salary_ta numeric(10,2),
    salary_esi boolean,
    salary_payment_method text DEFAULT 'cash'::text,
    source_of_employee text,
    is_test_entry boolean DEFAULT false NOT NULL,
    password_hash text,
    erp_login_enabled boolean DEFAULT false NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    login_mode text DEFAULT 'single'::text NOT NULL,
    ip_exception_type text DEFAULT 'none'::text NOT NULL,
    ip_exception_expires_at timestamp with time zone,
    last_increment_date date
);

CREATE TABLE public.erp_login_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    requested_email text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    rejection_reason text,
    temp_password text,
    temp_password_viewed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid
);

CREATE TABLE public.holiday_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.holidays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    holiday_date date,
    holiday_name text NOT NULL,
    holiday_type_id uuid,
    financial_year text NOT NULL,
    branch_id uuid,
    is_full_day boolean DEFAULT true NOT NULL,
    is_optional boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    template_key text,
    calendar_year integer
);

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL
);

CREATE TABLE public.payment_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    total_km numeric(10,2) DEFAULT 0 NOT NULL,
    total_cost numeric(10,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    paid_at timestamp with time zone,
    photos_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.payroll_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    basic_wages numeric(12,2) DEFAULT 0 NOT NULL,
    days_in_month integer DEFAULT 30 NOT NULL,
    working_days numeric(6,2) DEFAULT 0 NOT NULL,
    absent_days numeric(6,2) DEFAULT 0 NOT NULL,
    ot_hours numeric(8,2) DEFAULT 0 NOT NULL,
    incentives numeric(12,2) DEFAULT 0 NOT NULL,
    loan_deduction numeric(12,2) DEFAULT 0 NOT NULL,
    advance_deduction numeric(12,2) DEFAULT 0 NOT NULL,
    other_deduction numeric(12,2) DEFAULT 0 NOT NULL,
    loan_id uuid,
    advance_id uuid,
    ot_days numeric(8,2) DEFAULT 0 NOT NULL,
    salary_amount numeric(12,2) DEFAULT 0 NOT NULL,
    ot_charges numeric(12,2) DEFAULT 0 NOT NULL,
    total_earnings numeric(12,2) DEFAULT 0 NOT NULL,
    esi_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total_deductions numeric(12,2) DEFAULT 0 NOT NULL,
    net_payable numeric(12,2) DEFAULT 0 NOT NULL,
    remarks text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    incentive_remarks text
);

CREATE TABLE public.payroll_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    period_month integer NOT NULL,
    period_year integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    esi_wage_ceiling numeric(12,2),
    esi_employee_rate numeric(6,4),
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finalised_by uuid,
    finalised_at timestamp with time zone
);

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sub_head text NOT NULL,
    action text NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category text NOT NULL
);

CREATE TABLE public.relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_name text NOT NULL,
    ownership_type text NOT NULL,
    owner_employee_id uuid,
    rate_per_km numeric(10,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.vendor_bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    account_holder_name text NOT NULL,
    bank_name text NOT NULL,
    account_number text NOT NULL,
    ifsc text NOT NULL,
    branch text,
    is_primary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    deactivation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid
);

CREATE TABLE public.vendor_branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    address text NOT NULL,
    branch_alias text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    location_url text,
    gstin text,
    state_id uuid,
    city_id uuid,
    pincode text,
    branch_name text
);

CREATE TABLE public.vendor_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.vendor_contact_branch_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    branch_id uuid,
    designation text,
    is_active boolean DEFAULT true NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    vendor_id uuid
);

CREATE TABLE public.vendor_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    mobile text NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    other_no text,
    other_email text
);

CREATE TABLE public.vendor_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    slot text NOT NULL,
    document_name text,
    file_url text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.vendor_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id_a uuid NOT NULL,
    vendor_id_b uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_code text DEFAULT ('VEN-'::text || lpad((nextval('vendor_code_seq'::regclass))::text, 4, '0'::text)) NOT NULL,
    vendor_name text NOT NULL,
    vendor_category_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    pan text,
    msme_registered boolean DEFAULT false NOT NULL,
    msme_number text,
    primary_contact_name text NOT NULL,
    primary_contact_mobile text NOT NULL,
    primary_contact_email text,
    payment_terms_days integer,
    tds_applicable boolean DEFAULT false NOT NULL,
    tds_section text,
    created_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vendor_type text DEFAULT 'company'::text NOT NULL,
    deals_in text,
    is_trader boolean DEFAULT false NOT NULL,
    is_manufacturer boolean DEFAULT false NOT NULL,
    is_exporter boolean DEFAULT false NOT NULL,
    aadhar_number text,
    blacklist_status text DEFAULT 'not_blacklisted'::text NOT NULL,
    is_service_provider boolean DEFAULT false NOT NULL,
    other_numbers text,
    vendor_alias text,
    is_test_entry boolean DEFAULT false NOT NULL
);


-- ============================================================================
-- 5a. PRIMARY KEY AND UNIQUE CONSTRAINTS
-- ============================================================================

ALTER TABLE ONLY public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.asset_types ADD CONSTRAINT asset_types_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.branches ADD CONSTRAINT branches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cities ADD CONSTRAINT cities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.daily_entries ADD CONSTRAINT daily_entries_employee_id_entry_date_key UNIQUE (employee_id, entry_date);
ALTER TABLE ONLY public.daily_entries ADD CONSTRAINT daily_entries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.departments ADD CONSTRAINT departments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.designations ADD CONSTRAINT designations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_advances ADD CONSTRAINT employee_advances_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_assets ADD CONSTRAINT employee_assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_categories ADD CONSTRAINT employee_categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_documents ADD CONSTRAINT employee_documents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_education ADD CONSTRAINT employee_education_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_family_members ADD CONSTRAINT employee_family_members_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_loan_transactions ADD CONSTRAINT employee_loan_transactions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_loans ADD CONSTRAINT employee_loans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_nominees ADD CONSTRAINT employee_nominees_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_permissions ADD CONSTRAINT employee_permissions_employee_id_permission_id_key UNIQUE (employee_id, permission_id);
ALTER TABLE ONLY public.employee_permissions ADD CONSTRAINT employee_permissions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_sessions ADD CONSTRAINT employee_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employee_sessions ADD CONSTRAINT employee_sessions_token_key UNIQUE (token);
ALTER TABLE ONLY public.employee_work_experience ADD CONSTRAINT employee_work_experience_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_employee_code_key UNIQUE (employee_code);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_mobile_number_key UNIQUE (mobile_number);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.erp_login_requests ADD CONSTRAINT erp_login_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.holiday_types ADD CONSTRAINT holiday_types_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.holidays ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.password_reset_tokens ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.password_reset_tokens ADD CONSTRAINT password_reset_tokens_token_key UNIQUE (token);
ALTER TABLE ONLY public.payment_batches ADD CONSTRAINT payment_batches_employee_id_period_month_period_year_key UNIQUE (employee_id, period_month, period_year);
ALTER TABLE ONLY public.payment_batches ADD CONSTRAINT payment_batches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payroll_entries ADD CONSTRAINT payroll_entries_period_id_employee_id_key UNIQUE (period_id, employee_id);
ALTER TABLE ONLY public.payroll_entries ADD CONSTRAINT payroll_entries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payroll_periods ADD CONSTRAINT payroll_periods_period_month_period_year_key UNIQUE (period_month, period_year);
ALTER TABLE ONLY public.payroll_periods ADD CONSTRAINT payroll_periods_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.permissions ADD CONSTRAINT permissions_key_key UNIQUE (key);
ALTER TABLE ONLY public.permissions ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.relationships ADD CONSTRAINT relationships_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.states ADD CONSTRAINT states_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vehicles ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vendor_bank_accounts ADD CONSTRAINT vendor_bank_accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vendor_branches ADD CONSTRAINT vendor_branches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vendor_branches ADD CONSTRAINT vendor_branches_vendor_id_alias_key UNIQUE (vendor_id, branch_alias);
ALTER TABLE ONLY public.vendor_categories ADD CONSTRAINT vendor_categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vendor_contact_branch_links ADD CONSTRAINT vendor_contact_branch_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vendor_contacts ADD CONSTRAINT vendor_contacts_mobile_key UNIQUE (mobile);
ALTER TABLE ONLY public.vendor_contacts ADD CONSTRAINT vendor_contacts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vendor_documents ADD CONSTRAINT vendor_documents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vendor_relationships ADD CONSTRAINT vendor_relationships_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vendors ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vendors ADD CONSTRAINT vendors_vendor_code_key UNIQUE (vendor_code);


-- ============================================================================
-- 5b. CHECK CONSTRAINTS
-- ============================================================================
-- This database has no enum types; these CHECK constraints ARE the enums.

ALTER TABLE ONLY public.app_settings ADD CONSTRAINT single_row CHECK ((id = 1));
ALTER TABLE ONLY public.daily_entries ADD CONSTRAINT daily_entries_status_check CHECK ((status = ANY (ARRAY['pending_evening'::text, 'calculated'::text, 'approved'::text, 'rejected'::text, 'paid'::text])));
ALTER TABLE ONLY public.employee_advances ADD CONSTRAINT employee_advances_amount_check CHECK ((amount > (0)::numeric));
ALTER TABLE ONLY public.employee_advances ADD CONSTRAINT employee_advances_status_check CHECK ((status = ANY (ARRAY['outstanding'::text, 'recovered'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.employee_loan_transactions ADD CONSTRAINT employee_loan_transactions_txn_type_check CHECK ((txn_type = ANY (ARRAY['deduction'::text, 'adjustment'::text, 'waiver'::text])));
ALTER TABLE ONLY public.employee_loans ADD CONSTRAINT employee_loans_ledger_type_check CHECK ((ledger_type = ANY (ARRAY['loan'::text, 'advance'::text])));
ALTER TABLE ONLY public.employee_loans ADD CONSTRAINT employee_loans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_employee_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'left'::text])));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_father_husband_relation_check CHECK ((father_husband_relation = ANY (ARRAY['S/o'::text, 'D/o'::text, 'W/o'::text])));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_ip_exception_type_check CHECK ((ip_exception_type = ANY (ARRAY['none'::text, 'always_allow'::text, 'per_request'::text, 'time_limited'::text])));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_login_mode_check CHECK ((login_mode = ANY (ARRAY['single'::text, 'multiple'::text])));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_role_check CHECK ((role = ANY (ARRAY['employee'::text, 'admin'::text, 'owner'::text])));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_salary_payment_method_check CHECK ((salary_payment_method = ANY (ARRAY['cash'::text, 'bank'::text])));
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_source_of_employee_check CHECK ((source_of_employee = ANY (ARRAY['ref_employee'::text, 'placement_agency'::text, 'friends'::text, 'walk_in'::text, 'others'::text])));
ALTER TABLE ONLY public.erp_login_requests ADD CONSTRAINT erp_login_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE ONLY public.payment_batches ADD CONSTRAINT payment_batches_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text])));
ALTER TABLE ONLY public.payroll_periods ADD CONSTRAINT payroll_periods_period_month_check CHECK (((period_month >= 1) AND (period_month <= 12)));
ALTER TABLE ONLY public.payroll_periods ADD CONSTRAINT payroll_periods_period_year_check CHECK (((period_year >= 2000) AND (period_year <= 2100)));
ALTER TABLE ONLY public.payroll_periods ADD CONSTRAINT payroll_periods_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'finalised'::text])));
ALTER TABLE ONLY public.permissions ADD CONSTRAINT permissions_action_check CHECK ((action = ANY (ARRAY['view'::text, 'create'::text, 'edit'::text, 'approve'::text, 'delete'::text])));
ALTER TABLE ONLY public.vehicles ADD CONSTRAINT vehicles_ownership_type_check CHECK ((ownership_type = ANY (ARRAY['company'::text, 'employee'::text])));
ALTER TABLE ONLY public.vendor_contact_branch_links ADD CONSTRAINT link_has_branch_or_vendor CHECK (((branch_id IS NOT NULL) OR (vendor_id IS NOT NULL)));
ALTER TABLE ONLY public.vendor_relationships ADD CONSTRAINT vendor_relationships_check CHECK ((vendor_id_a <> vendor_id_b));
ALTER TABLE ONLY public.vendors ADD CONSTRAINT vendors_blacklist_status_check CHECK ((blacklist_status = ANY (ARRAY['not_blacklisted'::text, 'blacklisted'::text])));
ALTER TABLE ONLY public.vendors ADD CONSTRAINT vendors_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'approved'::text, 'rejected'::text, 'suspended'::text, 'blacklisted'::text])));
ALTER TABLE ONLY public.vendors ADD CONSTRAINT vendors_vendor_type_check CHECK ((vendor_type = ANY (ARRAY['company'::text, 'individual'::text])));


-- ============================================================================
-- 5c. FOREIGN KEY CONSTRAINTS
-- ============================================================================
-- Referenced tables are written unqualified exactly as pg_get_constraintdef()
-- rendered them; they all resolve to schema "public" under the search_path
-- set at the top of this file.

ALTER TABLE ONLY public.cities ADD CONSTRAINT cities_state_id_fkey FOREIGN KEY (state_id) REFERENCES states(id);
ALTER TABLE ONLY public.daily_entries ADD CONSTRAINT daily_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.daily_entries ADD CONSTRAINT daily_entries_payment_batch_id_fkey FOREIGN KEY (payment_batch_id) REFERENCES payment_batches(id);
ALTER TABLE ONLY public.daily_entries ADD CONSTRAINT daily_entries_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES employees(id);
ALTER TABLE ONLY public.daily_entries ADD CONSTRAINT daily_entries_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(id);
ALTER TABLE ONLY public.employee_advances ADD CONSTRAINT employee_advances_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_advances ADD CONSTRAINT employee_advances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_advances ADD CONSTRAINT employee_advances_recovered_in_period_id_fkey FOREIGN KEY (recovered_in_period_id) REFERENCES payroll_periods(id);
ALTER TABLE ONLY public.employee_assets ADD CONSTRAINT employee_assets_asset_type_id_fkey FOREIGN KEY (asset_type_id) REFERENCES asset_types(id);
ALTER TABLE ONLY public.employee_assets ADD CONSTRAINT employee_assets_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_documents ADD CONSTRAINT employee_documents_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_education ADD CONSTRAINT employee_education_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_family_members ADD CONSTRAINT employee_family_members_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_family_members ADD CONSTRAINT employee_family_members_relationship_id_fkey FOREIGN KEY (relationship_id) REFERENCES relationships(id);
ALTER TABLE ONLY public.employee_loan_transactions ADD CONSTRAINT employee_loan_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_loan_transactions ADD CONSTRAINT employee_loan_transactions_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES employee_loans(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_loan_transactions ADD CONSTRAINT employee_loan_transactions_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES payroll_periods(id);
ALTER TABLE ONLY public.employee_loans ADD CONSTRAINT employee_loans_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_loans ADD CONSTRAINT employee_loans_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_nominees ADD CONSTRAINT employee_nominees_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_permissions ADD CONSTRAINT employee_permissions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_permissions ADD CONSTRAINT employee_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES employees(id);
ALTER TABLE ONLY public.employee_permissions ADD CONSTRAINT employee_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES permissions(id);
ALTER TABLE ONLY public.employee_sessions ADD CONSTRAINT employee_sessions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.employee_work_experience ADD CONSTRAINT employee_work_experience_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_assigned_vehicle_id_fkey FOREIGN KEY (assigned_vehicle_id) REFERENCES vehicles(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_designation_id_fkey FOREIGN KEY (designation_id) REFERENCES designations(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_emergency_contact_city_id_fkey FOREIGN KEY (emergency_contact_city_id) REFERENCES cities(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_emergency_contact_state_id_fkey FOREIGN KEY (emergency_contact_state_id) REFERENCES states(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_employee_category_id_fkey FOREIGN KEY (employee_category_id) REFERENCES employee_categories(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_permanent_city_id_fkey FOREIGN KEY (permanent_city_id) REFERENCES cities(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_permanent_state_id_fkey FOREIGN KEY (permanent_state_id) REFERENCES states(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_present_city_id_fkey FOREIGN KEY (present_city_id) REFERENCES cities(id);
ALTER TABLE ONLY public.employees ADD CONSTRAINT employees_present_state_id_fkey FOREIGN KEY (present_state_id) REFERENCES states(id);
ALTER TABLE ONLY public.erp_login_requests ADD CONSTRAINT erp_login_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.erp_login_requests ADD CONSTRAINT erp_login_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES employees(id);
ALTER TABLE ONLY public.erp_login_requests ADD CONSTRAINT erp_login_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES employees(id);
ALTER TABLE ONLY public.holidays ADD CONSTRAINT holidays_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE ONLY public.holidays ADD CONSTRAINT holidays_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE ONLY public.holidays ADD CONSTRAINT holidays_holiday_type_id_fkey FOREIGN KEY (holiday_type_id) REFERENCES holiday_types(id);
ALTER TABLE ONLY public.password_reset_tokens ADD CONSTRAINT password_reset_tokens_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payment_batches ADD CONSTRAINT payment_batches_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.payroll_entries ADD CONSTRAINT payroll_entries_advance_id_fkey FOREIGN KEY (advance_id) REFERENCES employee_advances(id);
ALTER TABLE ONLY public.payroll_entries ADD CONSTRAINT payroll_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.payroll_entries ADD CONSTRAINT payroll_entries_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES employee_loans(id);
ALTER TABLE ONLY public.payroll_entries ADD CONSTRAINT payroll_entries_period_id_fkey FOREIGN KEY (period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payroll_periods ADD CONSTRAINT payroll_periods_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE ONLY public.payroll_periods ADD CONSTRAINT payroll_periods_finalised_by_fkey FOREIGN KEY (finalised_by) REFERENCES employees(id);
ALTER TABLE ONLY public.vehicles ADD CONSTRAINT vehicles_owner_employee_id_fkey FOREIGN KEY (owner_employee_id) REFERENCES employees(id);
ALTER TABLE ONLY public.vendor_bank_accounts ADD CONSTRAINT vendor_bank_accounts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES vendor_branches(id);
ALTER TABLE ONLY public.vendor_bank_accounts ADD CONSTRAINT vendor_bank_accounts_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id);
ALTER TABLE ONLY public.vendor_branches ADD CONSTRAINT vendor_branches_city_id_fkey FOREIGN KEY (city_id) REFERENCES cities(id);
ALTER TABLE ONLY public.vendor_branches ADD CONSTRAINT vendor_branches_state_id_fkey FOREIGN KEY (state_id) REFERENCES states(id);
ALTER TABLE ONLY public.vendor_branches ADD CONSTRAINT vendor_branches_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id);
ALTER TABLE ONLY public.vendor_contact_branch_links ADD CONSTRAINT vendor_contact_branch_links_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES vendor_branches(id);
ALTER TABLE ONLY public.vendor_contact_branch_links ADD CONSTRAINT vendor_contact_branch_links_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES vendor_contacts(id);
ALTER TABLE ONLY public.vendor_contact_branch_links ADD CONSTRAINT vendor_contact_branch_links_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id);
ALTER TABLE ONLY public.vendor_documents ADD CONSTRAINT vendor_documents_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id);
ALTER TABLE ONLY public.vendor_relationships ADD CONSTRAINT vendor_relationships_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE ONLY public.vendor_relationships ADD CONSTRAINT vendor_relationships_vendor_id_a_fkey FOREIGN KEY (vendor_id_a) REFERENCES vendors(id);
ALTER TABLE ONLY public.vendor_relationships ADD CONSTRAINT vendor_relationships_vendor_id_b_fkey FOREIGN KEY (vendor_id_b) REFERENCES vendors(id);
ALTER TABLE ONLY public.vendors ADD CONSTRAINT vendors_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES employees(id);
ALTER TABLE ONLY public.vendors ADD CONSTRAINT vendors_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE ONLY public.vendors ADD CONSTRAINT vendors_vendor_category_id_fkey FOREIGN KEY (vendor_category_id) REFERENCES vendor_categories(id);


-- ============================================================================
-- 6. INDEXES
-- ============================================================================
-- Indexes that back a PRIMARY KEY / UNIQUE constraint are omitted here; they
-- are created implicitly by the ALTER TABLE statements in section 5a.

CREATE INDEX idx_daily_entries_employee_date ON public.daily_entries USING btree (employee_id, entry_date);
CREATE INDEX idx_daily_entries_status ON public.daily_entries USING btree (status);
CREATE INDEX idx_employee_advances_employee_id ON public.employee_advances USING btree (employee_id);
CREATE INDEX idx_employee_advances_period ON public.employee_advances USING btree (payroll_period);
CREATE INDEX idx_employee_advances_status ON public.employee_advances USING btree (status);
CREATE INDEX idx_employee_assets_employee_id ON public.employee_assets USING btree (employee_id);
CREATE INDEX idx_employee_documents_employee_id ON public.employee_documents USING btree (employee_id);
CREATE INDEX idx_employee_education_employee_id ON public.employee_education USING btree (employee_id);
CREATE INDEX idx_employee_family_members_employee_id ON public.employee_family_members USING btree (employee_id);
CREATE INDEX idx_loan_txn_loan_id ON public.employee_loan_transactions USING btree (loan_id);
CREATE INDEX idx_loan_txn_payroll_period ON public.employee_loan_transactions USING btree (payroll_period_id);
CREATE INDEX idx_loan_txn_period ON public.employee_loan_transactions USING btree (payroll_period);
CREATE INDEX idx_employee_loans_employee_id ON public.employee_loans USING btree (employee_id);
CREATE INDEX idx_employee_loans_status ON public.employee_loans USING btree (status);
CREATE INDEX idx_employee_nominees_employee_id ON public.employee_nominees USING btree (employee_id);
CREATE INDEX idx_employee_sessions_employee_id ON public.employee_sessions USING btree (employee_id);
CREATE INDEX idx_employee_sessions_token ON public.employee_sessions USING btree (token);
CREATE INDEX idx_employee_work_experience_employee_id ON public.employee_work_experience USING btree (employee_id);
CREATE INDEX idx_employees_created_at ON public.employees USING btree (created_at DESC);
CREATE INDEX idx_erp_login_requests_employee_id ON public.erp_login_requests USING btree (employee_id);
CREATE INDEX idx_erp_login_requests_requested_by ON public.erp_login_requests USING btree (requested_by);
CREATE INDEX idx_erp_login_requests_status ON public.erp_login_requests USING btree (status);
CREATE INDEX idx_holidays_branch_id ON public.holidays USING btree (branch_id);
CREATE INDEX idx_holidays_calendar_year ON public.holidays USING btree (calendar_year);
CREATE INDEX idx_holidays_date ON public.holidays USING btree (holiday_date);
CREATE INDEX idx_holidays_financial_year ON public.holidays USING btree (financial_year);
CREATE INDEX idx_holidays_template_key ON public.holidays USING btree (template_key);
CREATE INDEX idx_password_reset_tokens_token ON public.password_reset_tokens USING btree (token);
CREATE INDEX idx_payment_batches_employee_period ON public.payment_batches USING btree (employee_id, period_year, period_month);
CREATE INDEX idx_payroll_entries_employee ON public.payroll_entries USING btree (employee_id);
CREATE INDEX idx_payroll_entries_period ON public.payroll_entries USING btree (period_id);
CREATE INDEX idx_payroll_periods_status ON public.payroll_periods USING btree (status);
CREATE INDEX idx_vehicles_owner_employee_id ON public.vehicles USING btree (owner_employee_id);
CREATE INDEX idx_vendor_bank_accounts_branch_id ON public.vendor_bank_accounts USING btree (branch_id);
CREATE INDEX idx_vendor_bank_accounts_vendor_id ON public.vendor_bank_accounts USING btree (vendor_id);
CREATE INDEX idx_vendor_branches_vendor_id ON public.vendor_branches USING btree (vendor_id);
CREATE INDEX idx_vendor_contact_branch_links_branch_id ON public.vendor_contact_branch_links USING btree (branch_id);
CREATE INDEX idx_vendor_contact_branch_links_vendor_id ON public.vendor_contact_branch_links USING btree (vendor_id);
CREATE INDEX idx_vendor_documents_vendor_id ON public.vendor_documents USING btree (vendor_id);
CREATE INDEX idx_vendor_relationships_vendor_id_a ON public.vendor_relationships USING btree (vendor_id_a);
CREATE INDEX idx_vendor_relationships_vendor_id_b ON public.vendor_relationships USING btree (vendor_id_b);
CREATE UNIQUE INDEX idx_vendors_aadhar ON public.vendors USING btree (aadhar_number) WHERE (aadhar_number IS NOT NULL);
CREATE INDEX idx_vendors_created_at ON public.vendors USING btree (created_at DESC);
CREATE INDEX idx_vendors_pan ON public.vendors USING btree (pan);


-- ============================================================================
-- 7. FUNCTIONS AND PROCEDURES
-- ============================================================================
-- None. pg_proc returned zero rows for schema "public".
-- All business logic lives in the client (admin.html / documentation.js) and
-- in Supabase Edge Functions under supabase/functions/ -- NOT in the database.


-- ============================================================================
-- 8. TRIGGERS
-- ============================================================================
-- None. pg_trigger returned zero non-internal triggers for schema "public".
-- Note: columns named updated_at exist on several tables but are NOT
-- maintained by a database trigger; the application must set them.


-- ============================================================================
-- 9. VIEWS AND MATERIALIZED VIEWS
-- ============================================================================
-- None. pg_class returned no relkind 'v' or 'm' relations in schema "public".


-- ============================================================================
-- 10. ROW LEVEL SECURITY
-- ============================================================================
-- RLS is ENABLED on all 39 tables, and there are ZERO policies (pg_policy
-- returned no rows for schema "public"). With RLS on and no policy, the
-- anon and authenticated roles can read/write nothing; all access goes
-- through the service_role key, which bypasses RLS.
-- Recreating this exactly reproduces that posture.

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_education ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_loan_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_nominees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_work_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_login_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holiday_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_contact_branch_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

-- No CREATE POLICY statements: the Tokyo database had none.


-- ============================================================================
-- 11. STORAGE BUCKETS  (documentation only -- NOT executable SQL)
-- ============================================================================
-- SELECT id, name, public FROM storage.buckets;
--
--   id                    name                  public   file_size_limit
--   --------------------  --------------------  -------  ----------------
--   employee-documents    employee-documents    false    5242880   (5 MB)
--   vehicle-km-photos     vehicle-km-photos     false    524288    (512 KB)
--   vendor-documents      vendor-documents      false    5242880   (5 MB)
--
-- All three buckets are PRIVATE. Object contents are not part of this export;
-- they must be copied separately when moving regions.
-- ============================================================================


-- ============================================================================
-- 12. LIVE ROW COUNTS AT EXPORT TIME  (documentation only)
-- ============================================================================
-- SELECT count(*) per table in schema public, 2026-09-09, Tokyo project.
-- No rows are included in this file -- this list exists only so the next
-- session knows what data was present before the Mumbai migration.
--
--   table                            rows
--   -------------------------------  ----
--   app_settings                     1
--   asset_types                      0
--   branches                         3
--   cities                           77
--   daily_entries                    3
--   departments                      11
--   designations                     17
--   employee_advances                0
--   employee_assets                  0
--   employee_categories              2
--   employee_documents               1
--   employee_education               15
--   employee_family_members          7
--   employee_loan_transactions       1
--   employee_loans                   1
--   employee_nominees                5
--   employee_permissions             3
--   employee_sessions                10
--   employee_work_experience         6
--   employees                        17
--   erp_login_requests               0
--   holiday_types                    4
--   holidays                         9
--   password_reset_tokens            1
--   payment_batches                  2
--   payroll_entries                  0
--   payroll_periods                  0
--   permissions                      27
--   relationships                    6
--   states                           33
--   vehicles                         5
--   vendor_bank_accounts             23
--   vendor_branches                  25
--   vendor_categories                4
--   vendor_contact_branch_links      0
--   vendor_contacts                  0
--   vendor_documents                 0
--   vendor_relationships             0
--   vendors                          25
--
--   39 tables, 300 rows total.
--   Sequence public.vendor_code_seq last_value = 26.
-- ============================================================================
-- END OF SCHEMA SNAPSHOT
-- ============================================================================
