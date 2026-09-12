// ============================================================
// payroll-actions — the Salary Calculator's one back door.
//
// What changed from Tokyo, and why:
//
//  1. IDENTITY. The old version read `requester_id` out of the request
//     body and believed it: anyone who knew a UUID could run payroll as
//     that person. There is no `requester_id` in this file. The caller
//     comes only from `authenticate(req)`, which reads the signed token.
//     Any identity field arriving in the body is read past and ignored.
//
//  2. MONEY. The old file already re-read `basic_wages` and
//     `days_in_month` from the database instead of trusting the request.
//     That instinct is now the rule: every money figure on a payroll row
//     is computed here, from figures the server read itself. Earnings,
//     ESI, PF, totals and net payable sent in a request are discarded
//     without comment. Only the countable facts a human types --
//     days present, overtime hours, incentive, the deduction amounts and
//     the remarks -- are taken from the request, and those are bounded.
//
//  3. SHAPE. The employee is now `parties` + `employee_details` +
//     `party_roles`, and there is no pay column on the employee at all.
//     What someone is paid lives in `salary_records`, a dated history;
//     the wage for a month is the newest record already in force, which
//     is what `public.current_salary(party_id, date)` returns.
//
//  4. THE RULES ARE SNAPSHOTTED. The ESI and PF ceilings and rates are
//     copied onto the payroll period when the sheet is created. Re-open
//     a sheet from two years ago and it still recalculates on the rules
//     that applied then, not on today's.
//
//  5. BALANCES ARE NEVER STORED. What is still owed on a loan or an
//     advance comes only from `loan_balances` / `advance_balances`,
//     which add up the ledger. Nothing here writes a balance column,
//     because there isn't one.
//
//  6. NOTHING IS DELETED. Throwing away a draft sheet sets it, and its
//     rows, to 'cancelled'.
//
//  7. FINALISING IS IDEMPOTENT. It is the only step that posts to the
//     loan and advance ledgers, it claims the sheet before it posts, and
//     every posting is tagged with the payroll entry that caused it --
//     so running it twice cannot deduct twice.
//
// The screen has not been rewritten yet, so every reply carries the old
// field names it reads (`employee_id`, `working_days`, `ot_hours`,
// `incentives`, `salary_amount`, `ot_charges`, `esi_amount`, ...) beside
// the real new ones, and both the old and the short action names are
// accepted. When the screen is rewritten the aliases come out.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate, handle, json, requireActiveEmployee, requirePermission,
  AuthError, type Caller,
} from "../_shared/auth.ts";

// ---------- small helpers ----------

function round2(n: unknown): number {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** A number a human typed. Never negative, never nonsense, never a string. */
function positiveNumber(v: unknown): number {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  return n;
}

function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split("T")[0];
}

function uuidArg(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) {
      return c;
    }
  }
  return null;
}

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, 2000) : null;
}

/** The first of the month, as the database stores it. */
function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().split("T")[0];
}
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function partsOf(periodMonth: string): { year: number; month: number } {
  const s = String(periodMonth);
  return { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) };
}

/**
 * The month the caller means. Accepts the new shape (`period_month`, a
 * date) and the old one (`period_month` + `period_year`, numbers).
 */
function wantedMonth(body: Record<string, unknown>): { first: string; year: number; month: number } {
  const raw = body.period_month;
  let year: number;
  let month: number;

  if (typeof raw === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(raw)) {
    year = Number(raw.slice(0, 4));
    month = Number(raw.slice(5, 7));
  } else {
    month = Number(raw ?? body.month);
    year = Number(body.period_year ?? body.year);
  }

  if (!month || month < 1 || month > 12) throw new AuthError("Please choose a valid month.", 400);
  if (!year || year < 2000 || year > 2100) throw new AuthError("Please choose a valid year.", 400);
  return { first: monthStart(year, month), year, month };
}

// ---------- the arithmetic ----------
// These are the formulas already proven in the company's salary
// spreadsheet, unchanged from Tokyo. They run here and nowhere else:
// the browser never decides what anyone is paid.

interface RuleSet {
  daysInMonth: number;
  esiCeiling: number;
  esiEmployeeRate: number;
  esiEmployerRate: number;
  pfApplicable: boolean;
  pfCeiling: number | null;
  pfEmployeeRate: number;
}

interface TypedFacts {
  basicWages: number;        // read from the row, not the request
  daysPresent: number;
  overtimeHours: number;
  incentive: number;
  otherEarnings: number;
  loanDeduction: number;
  advanceDeduction: number;
  otherDeductions: number;
  esiApplicable: boolean;
  pfApplicableToPerson: boolean;
}

function computeEntry(f: TypedFacts, rules: RuleSet) {
  const basic = f.basicWages;
  const daysInMonth = rules.daysInMonth > 0 ? rules.daysInMonth : 30;

  const perDay = basic / daysInMonth;
  const otDays = f.overtimeHours / 8;                   // 8 hours = 1 OT day
  const earnedWages = round2(perDay * f.daysPresent);   // prorated by days actually present
  const overtimeAmount = round2(perDay * otDays);       // OT paid at the same per-day rate
  const totalEarnings = round2(earnedWages + overtimeAmount + f.incentive + f.otherEarnings);

  // ESI eligibility is judged on the FULL monthly wage (the statutory
  // ceiling), but the amount is charged on what was actually earned.
  let esiEmployee = 0;
  let esiEmployer = 0;
  if (f.esiApplicable && basic > 0 && basic <= rules.esiCeiling) {
    esiEmployee = round2(earnedWages * (rules.esiEmployeeRate / 100));
    esiEmployer = round2(earnedWages * (rules.esiEmployerRate / 100));
  }

  // PF works the same way, and only if the month's snapshot says PF
  // applied to the company AND this person is enrolled.
  let pfEmployee = 0;
  if (rules.pfApplicable && f.pfApplicableToPerson && basic > 0 &&
      (rules.pfCeiling === null || basic <= rules.pfCeiling)) {
    pfEmployee = round2(earnedWages * (rules.pfEmployeeRate / 100));
  }

  const totalDeductions = round2(
    f.loanDeduction + f.advanceDeduction + f.otherDeductions + esiEmployee + pfEmployee,
  );

  return {
    days_present: round2(f.daysPresent),
    overtime_hours: round2(f.overtimeHours),
    // The per-hour rate, kept for the payslip. The amount above is worked
    // out from the unrounded per-day figure, exactly as the sheet does.
    overtime_rate: round2(perDay / 8),
    earned_wages: earnedWages,
    overtime_amount: overtimeAmount,
    incentive: round2(f.incentive),
    other_earnings: round2(f.otherEarnings),
    total_earnings: totalEarnings,
    esi_employee: esiEmployee,
    esi_employer: esiEmployer,
    pf_employee: pfEmployee,
    loan_deduction: round2(f.loanDeduction),
    advance_deduction: round2(f.advanceDeduction),
    other_deductions: round2(f.otherDeductions),
    total_deductions: totalDeductions,
    net_payable: round2(totalEarnings - totalDeductions),
  };
}

function rulesOf(period: Record<string, unknown>): RuleSet {
  return {
    daysInMonth: Number(period.days_in_month ?? 30),
    esiCeiling: Number(period.esi_wage_ceiling ?? 21000),
    esiEmployeeRate: Number(period.esi_employee_rate ?? 0.75),
    esiEmployerRate: Number(period.esi_employer_rate ?? 3.25),
    pfApplicable: !!period.pf_applicable,
    pfCeiling: period.pf_wage_ceiling === null || period.pf_wage_ceiling === undefined
      ? null : Number(period.pf_wage_ceiling),
    pfEmployeeRate: Number(period.pf_employee_rate ?? 0),
  };
}

// ---------- dressing the reply ----------

function shapePeriod(p: Record<string, unknown>) {
  const { year, month } = partsOf(p.period_month as string);
  return {
    ...p,
    period_year: year,          // legacy alias
    period_month_no: month,     // legacy alias (period_month is now a date)
    is_finalised: p.status === "completed",
    is_cancelled: p.status === "cancelled",
  };
}

function shapeEntry(
  e: Record<string, unknown>,
  daysInMonth: number,
  extra: Record<string, unknown> = {},
) {
  const present = Number(e.days_present ?? 0);
  return {
    ...e,
    employee_id: e.party_id,                              // legacy alias
    days_in_month: daysInMonth,                           // lives on the period now
    absent_days: round2(daysInMonth - present),           // always derived, never typed
    working_days: present,                                // legacy alias
    ot_hours: e.overtime_hours,                           // legacy alias
    ot_days: round2(Number(e.overtime_hours ?? 0) / 8),
    incentives: e.incentive,                              // legacy alias
    salary_amount: e.earned_wages,                        // legacy alias
    ot_charges: e.overtime_amount,                        // legacy alias
    esi_amount: e.esi_employee,                           // legacy alias
    other_deduction: e.other_deductions,                  // legacy alias
    ...extra,
  };
}

// ---------- people ----------

interface Person {
  party_id: string;
  name: string;
  party_number: string | null;
  mobile: string | null;
  department: string | null;
  designation: string | null;
  branch: string | null;
  employment_state: string | null;
  date_of_joining: string | null;
  esi_applicable: boolean;
  pf_applicable: boolean;
  esi_number: string | null;
  uan_number: string | null;
}

/**
 * Everyone on the payroll. `onlyActive` limits it to people employed in
 * the month being worked on.
 */
async function loadPeople(
  admin: Caller["admin"],
  opts: { onlyActive?: boolean; onOrBefore?: string; partyIds?: string[] } = {},
): Promise<Map<string, Person>> {
  const { data: roleRows, error: roleErr } = await admin
    .from("party_roles")
    .select("party_id")
    .eq("role", "employee")
    .eq("status", "approved");
  if (roleErr) throw roleErr;
  let ids = [...new Set((roleRows ?? []).map((r) => r.party_id as string))];
  if (opts.partyIds) {
    const wanted = new Set(opts.partyIds);
    ids = [...new Set([...ids.filter((i) => wanted.has(i)), ...opts.partyIds])];
  }
  if (ids.length === 0) return new Map();

  const [partiesRes, detailsRes, deptRes, desigRes, branchRes] = await Promise.all([
    admin.from("parties").select("id, display_name, party_number, primary_mobile, status").in("id", ids),
    admin.from("employee_details")
      .select("party_id, employment_state, date_of_joining, date_of_leaving, esi_applicable, pf_applicable, esi_number, uan_number, department_id, designation_id, branch_id")
      .in("party_id", ids),
    admin.from("departments").select("id, name"),
    admin.from("designations").select("id, name"),
    admin.from("branches").select("id, name"),
  ]);
  if (partiesRes.error) throw partiesRes.error;
  if (detailsRes.error) throw detailsRes.error;

  const nameOf = (rows: Array<{ id: string; name: string }> | null | undefined, id: unknown) =>
    (rows ?? []).find((r) => r.id === id)?.name ?? null;

  const detailByParty = new Map(
    (detailsRes.data ?? []).map((d) => [d.party_id as string, d]),
  );

  const out = new Map<string, Person>();
  for (const p of partiesRes.data ?? []) {
    if (p.status === "cancelled") continue;
    const d = detailByParty.get(p.id as string);

    if (opts.onlyActive) {
      if ((d?.employment_state ?? "active") !== "active") continue;
      if (opts.onOrBefore && d?.date_of_joining && String(d.date_of_joining) > opts.onOrBefore) continue;
    }

    out.set(p.id as string, {
      party_id: p.id as string,
      name: p.display_name as string,
      party_number: (p.party_number as string) ?? null,
      mobile: (p.primary_mobile as string) ?? null,
      department: nameOf(deptRes.data as Array<{ id: string; name: string }> | null, d?.department_id),
      designation: nameOf(desigRes.data as Array<{ id: string; name: string }> | null, d?.designation_id),
      branch: nameOf(branchRes.data as Array<{ id: string; name: string }> | null, d?.branch_id),
      employment_state: d?.employment_state ?? null,
      date_of_joining: (d?.date_of_joining as string) ?? null,
      esi_applicable: d?.esi_applicable ?? true,
      pf_applicable: d?.pf_applicable ?? false,
      esi_number: (d?.esi_number as string) ?? null,
      uan_number: (d?.uan_number as string) ?? null,
    });
  }
  return out;
}

/** The wage in force for one person in one month. From salary_records only. */
async function wageFor(admin: Caller["admin"], partyId: string, on: string): Promise<number> {
  const { data, error } = await admin.rpc("current_salary", { p_party_id: partyId, p_on: on });
  if (error) throw error;
  const rec = Array.isArray(data) ? data[0] : data;
  if (!rec) return 0;
  return round2(
    Number(rec.basic ?? 0) + Number(rec.hra ?? 0) + Number(rec.da ?? 0) +
    Number(rec.ta ?? 0) + Number(rec.other_allowance ?? 0),
  );
}

// ---------- what is still owed ----------
// Only ever from the balance views. There is no balance column to read.

interface OpenDebt { id: string; party_id: string; outstanding: number; order: string }
interface OpenLoan extends OpenDebt { instalment: number }

async function openLoans(admin: Caller["admin"], upToMonth: string): Promise<OpenLoan[]> {
  const { data: loans, error } = await admin
    .from("employee_loans")
    .select("id, party_id, instalment_amount, first_recovery_month, loan_date, status")
    .eq("status", "approved")
    .lte("first_recovery_month", upToMonth);
  if (error) throw error;
  if (!loans || loans.length === 0) return [];

  const { data: balances, error: balErr } = await admin
    .from("loan_balances")
    .select("loan_id, party_id, outstanding")
    .in("loan_id", loans.map((l) => l.id as string));
  if (balErr) throw balErr;
  const outstandingById = new Map(
    (balances ?? []).map((b) => [b.loan_id as string, Number(b.outstanding ?? 0)]),
  );

  return loans
    .map((l) => ({
      id: l.id as string,
      party_id: l.party_id as string,
      outstanding: round2(outstandingById.get(l.id as string) ?? 0),
      instalment: Number(l.instalment_amount ?? 0),
      order: `${l.first_recovery_month}|${l.loan_date}|${l.id}`,
    }))
    .filter((l) => l.outstanding > 0)
    .sort((a, b) => a.order.localeCompare(b.order));
}

async function openAdvances(admin: Caller["admin"], upToMonth: string): Promise<OpenDebt[]> {
  const { data: advances, error } = await admin
    .from("employee_advances")
    .select("id, party_id, recovery_month, advance_date, status")
    .eq("status", "approved")
    .lte("recovery_month", upToMonth);
  if (error) throw error;
  if (!advances || advances.length === 0) return [];

  const { data: balances, error: balErr } = await admin
    .from("advance_balances")
    .select("advance_id, party_id, outstanding")
    .in("advance_id", advances.map((a) => a.id as string));
  if (balErr) throw balErr;
  const outstandingById = new Map(
    (balances ?? []).map((b) => [b.advance_id as string, Number(b.outstanding ?? 0)]),
  );

  return advances
    .map((a) => ({
      id: a.id as string,
      party_id: a.party_id as string,
      outstanding: round2(outstandingById.get(a.id as string) ?? 0),
      order: `${a.recovery_month}|${a.advance_date}|${a.id}`,
    }))
    .filter((a) => a.outstanding > 0)
    .sort((a, b) => a.order.localeCompare(b.order));
}

function sumBy(list: OpenDebt[], partyId: string): number {
  return round2(list.filter((d) => d.party_id === partyId)
    .reduce((s, d) => s + d.outstanding, 0));
}

// ============================================================
//  the actions
// ============================================================

// ---------------- LIST PERIODS ----------------
async function listPeriods(me: Caller) {
  requirePermission(me, "payroll.view");
  const { data, error } = await me.admin
    .from("payroll_periods")
    .select("*")
    .order("period_month", { ascending: false });
  if (error) throw error;
  return json({ success: true, periods: (data ?? []).map(shapePeriod) }, 200);
}

// ---------------- CREATE A MONTH ----------------
// The ESI and PF rules in force today are copied onto the sheet here and
// never read from app_settings again, so re-opening an old month cannot
// silently recalculate it on today's rules.
async function createPeriod(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "payroll.create");
  const admin = me.admin;
  const { first, year, month } = wantedMonth(body);
  const lastDay = monthEnd(year, month);

  const { data: existing, error: exErr } = await admin
    .from("payroll_periods").select("*").eq("period_month", first).maybeSingle();
  if (exErr) throw exErr;
  if (existing && existing.status !== "cancelled") {
    throw new AuthError("A salary sheet already exists for this month.", 409);
  }

  const { data: settings, error: setErr } = await admin
    .from("app_settings")
    .select("esi_wage_ceiling, esi_employee_rate, esi_employer_rate, pf_applicable_company_wide, pf_wage_ceiling, pf_employee_rate")
    .eq("id", 1).maybeSingle();
  if (setErr) throw setErr;

  const snapshot = {
    days_in_month: daysIn(year, month),
    esi_wage_ceiling: Number(settings?.esi_wage_ceiling ?? 21000),
    esi_employee_rate: Number(settings?.esi_employee_rate ?? 0.75),
    esi_employer_rate: Number(settings?.esi_employer_rate ?? 3.25),
    pf_applicable: !!settings?.pf_applicable_company_wide,
    pf_wage_ceiling: settings?.pf_wage_ceiling ?? null,
    pf_employee_rate: settings?.pf_employee_rate ?? null,
  };

  let period: Record<string, unknown>;
  if (existing) {
    // The month is UNIQUE and nothing is ever deleted, so a month whose
    // draft was thrown away is re-opened rather than left unusable. It
    // keeps its document number; the rules are snapshotted afresh.
    const { data: revived, error: revErr } = await admin
      .from("payroll_periods")
      .update({ ...snapshot, status: "draft", finalised_at: null, finalised_by: null })
      .eq("id", existing.id).eq("status", "cancelled")
      .select().single();
    if (revErr) throw revErr;
    period = revived;
  } else {
    const { data: docNumber, error: numErr } = await admin
      .rpc("next_human_number", { p_series_key: "payroll_period" });
    if (numErr) throw numErr;

    const { data: created, error: perErr } = await admin
      .from("payroll_periods")
      .insert({
        document_number: docNumber,
        period_month: first,
        ...snapshot,
        status: "draft",
        remarks: text(body.remarks),
        created_by: me.partyId,
      })
      .select().single();
    if (perErr) throw perErr;
    period = created;
  }

  // One row per employee on the books this month, with the wage that was
  // in force for them and this month's suggested recoveries.
  const people = await loadPeople(admin, { onlyActive: true, onOrBefore: lastDay });
  const loans = await openLoans(admin, first);
  const advances = await openAdvances(admin, first);

  const { data: alreadyThere, error: atErr } = await admin
    .from("payroll_entries").select("id, party_id").eq("period_id", period.id);
  if (atErr) throw atErr;
  const entryIdByParty = new Map(
    (alreadyThere ?? []).map((r) => [r.party_id as string, r.id as string]),
  );

  let seeded = 0;
  for (const person of people.values()) {
    const basic = await wageFor(admin, person.party_id, lastDay);

    // Suggested only: a smaller instalment this month simply means typing
    // a smaller number before finalising. Capped at what is really owed.
    const loanSuggestion = round2(
      loans.filter((l) => l.party_id === person.party_id)
        .reduce((s, l) => s + Math.min(l.instalment > 0 ? l.instalment : l.outstanding, l.outstanding), 0),
    );
    // Advances are early salary for this month, so recovered in full by default.
    const advanceSuggestion = sumBy(advances, person.party_id);

    const row = {
      period_id: period.id,
      party_id: person.party_id,
      basic_wages: basic,
      days_present: 0,
      overtime_hours: 0,
      overtime_rate: round2(basic / snapshot.days_in_month / 8),
      earned_wages: 0,
      overtime_amount: 0,
      incentive: 0,
      other_earnings: 0,
      total_earnings: 0,
      esi_employee: 0,
      esi_employer: 0,
      pf_employee: 0,
      loan_deduction: round2(loanSuggestion),
      advance_deduction: round2(advanceSuggestion),
      other_deductions: 0,
      total_deductions: round2(loanSuggestion + advanceSuggestion),
      net_payable: round2(0 - loanSuggestion - advanceSuggestion),
      incentive_remarks: null,
      remarks: null,
      status: "draft",
    };

    const existingEntryId = entryIdByParty.get(person.party_id);
    if (existingEntryId) {
      const { error } = await admin.from("payroll_entries")
        .update(row).eq("id", existingEntryId);
      if (error) throw error;
    } else {
      const { error } = await admin.from("payroll_entries")
        .insert({ ...row, created_by: me.partyId });
      if (error) throw error;
    }
    seeded++;
  }

  return json({
    success: true,
    period: shapePeriod(period),
    employee_count: seeded,
    reopened: !!existing,
  }, 200);
}

// ---------------- LOAD A SHEET ----------------
async function loadSheet(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "payroll.view");
  const admin = me.admin;

  const periodId = uuidArg(body.period_id);
  if (!periodId) throw new AuthError("Missing period_id", 400);

  const { data: period, error: perErr } = await admin
    .from("payroll_periods").select("*").eq("id", periodId).maybeSingle();
  if (perErr) throw perErr;
  if (!period) throw new AuthError("Salary sheet not found", 404);

  const { data: entries, error } = await admin
    .from("payroll_entries").select("*").eq("period_id", periodId);
  if (error) throw error;

  const partyIds = (entries ?? []).map((e) => e.party_id as string);
  const people = await loadPeople(admin, { partyIds });

  // Days at the current wage are counted as PRESENT DAYS actually
  // recorded, not calendar days -- the company grants an increment after
  // roughly 340 days present. This sums days_present from every earlier
  // sheet whose month begins on or after the increment that set the wage
  // now in force; the current month's days are added live in the screen.
  const priorPresent: Record<string, number> = {};
  const incrementFrom: Record<string, string | null> = {};
  if (partyIds.length > 0) {
    const [salRes, periodsRes, priorRes] = await Promise.all([
      admin.from("salary_records")
        .select("party_id, effective_from, status")
        .in("party_id", partyIds)
        .lte("effective_from", period.period_month)
        .in("status", ["approved", "completed"])
        .order("effective_from", { ascending: false }),
      admin.from("payroll_periods").select("id, period_month, status"),
      admin.from("payroll_entries")
        .select("party_id, period_id, days_present")
        .in("party_id", partyIds)
        .neq("period_id", periodId),
    ]);
    if (salRes.error) throw salRes.error;
    if (periodsRes.error) throw periodsRes.error;
    if (priorRes.error) throw priorRes.error;

    for (const s of salRes.data ?? []) {
      const p = s.party_id as string;
      if (!(p in incrementFrom)) incrementFrom[p] = s.effective_from as string;
    }

    const periodById = new Map(
      (periodsRes.data ?? []).map((p) => [p.id as string, p]),
    );

    for (const row of priorRes.data ?? []) {
      const inc = incrementFrom[row.party_id as string];
      if (!inc) continue;
      const p = periodById.get(row.period_id as string);
      if (!p || p.status === "cancelled") continue;
      // A salary month counts if the month itself starts on or after the
      // month the increment took effect in.
      const incMonthStart = `${String(inc).slice(0, 7)}-01`;
      if (String(p.period_month) >= incMonthStart) {
        priorPresent[row.party_id as string] =
          (priorPresent[row.party_id as string] ?? 0) + Number(row.days_present ?? 0);
      }
    }
  }

  const daysInMonth = Number(period.days_in_month ?? 30);
  const shaped = (entries ?? []).map((e) => {
    const person = people.get(e.party_id as string);
    return shapeEntry(e, daysInMonth, {
      prior_present_days: round2(priorPresent[e.party_id as string] ?? 0),
      last_increment_date: incrementFrom[e.party_id as string] ?? null,
      parties: person
        ? { display_name: person.name, party_number: person.party_number, primary_mobile: person.mobile }
        : null,
      employees: person                                     // legacy alias
        ? {
          id: person.party_id,
          name: person.name,
          employee_code: person.party_number,
          esi_applicable: person.esi_applicable,
          departments: person.department ? { name: person.department } : null,
          designations: person.designation ? { name: person.designation } : null,
        }
        : null,
    });
  });

  const sortKey = (row: Record<string, unknown>) => {
    const p = people.get(row.party_id as string);
    return `${p?.party_number ?? "zzzz"}|${p?.name ?? ""}`;
  };
  shaped.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  return json({ success: true, period: shapePeriod(period), entries: shaped }, 200);
}

// ---------------- SAVE GRID EDITS ----------------
// What a human typed is taken from the request. Every rupee figure is
// worked out here from the wage on the row and the rules on the period.
// A `net_payable` or `total_earnings` sent in the request is ignored.
async function saveSheet(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "payroll.edit");
  const admin = me.admin;

  const periodId = uuidArg(body.period_id);
  const sent = body.entries;
  if (!periodId || !Array.isArray(sent)) throw new AuthError("Invalid request", 400);

  const { data: period, error: perErr } = await admin
    .from("payroll_periods").select("*").eq("id", periodId).maybeSingle();
  if (perErr) throw perErr;
  if (!period) throw new AuthError("Salary sheet not found", 404);
  if (period.status === "completed") {
    throw new AuthError("This salary sheet is finalised and can no longer be edited.", 400);
  }
  if (period.status === "cancelled") {
    throw new AuthError("This salary sheet was cancelled and can no longer be edited.", 400);
  }

  // The stored rows are the truth about who is on this sheet and what
  // they are paid. The request can only say what was typed into them.
  const { data: storedRows, error: stErr } = await admin
    .from("payroll_entries")
    .select("id, party_id, basic_wages, status")
    .eq("period_id", periodId);
  if (stErr) throw stErr;
  const storedById = new Map((storedRows ?? []).map((r) => [r.id as string, r]));

  const people = await loadPeople(admin, {
    partyIds: (storedRows ?? []).map((r) => r.party_id as string),
  });
  const rules = rulesOf(period);

  let saved = 0;
  for (const raw of sent as Record<string, unknown>[]) {
    const entryId = uuidArg(raw.id, raw.entry_id);
    if (!entryId) continue;
    const stored = storedById.get(entryId);
    if (!stored) continue;                 // not on this sheet: ignored outright

    const person = people.get(stored.party_id as string);
    const who = person?.name ?? "an employee";

    const daysPresent = positiveNumber(raw.days_present ?? raw.working_days);
    const overtimeHours = positiveNumber(raw.overtime_hours ?? raw.ot_hours);

    if (Number(raw.days_present ?? raw.working_days ?? 0) < 0 ||
        Number(raw.overtime_hours ?? raw.ot_hours ?? 0) < 0) {
      throw new AuthError(`Negative values are not allowed (${who}).`, 400);
    }
    // Rejected outright rather than silently clamped: a wrong day count
    // should be corrected by a person, not quietly rounded down.
    if (daysPresent > rules.daysInMonth) {
      throw new AuthError(
        `Days present (${daysPresent}) cannot exceed the ${rules.daysInMonth} days in this month — please check ${who}.`,
        400,
      );
    }
    if (overtimeHours > rules.daysInMonth * 24) {
      throw new AuthError(`Overtime hours are not possible for ${who}.`, 400);
    }

    const computed = computeEntry({
      basicWages: Number(stored.basic_wages ?? 0),   // from the row, never the request
      daysPresent,
      overtimeHours,
      incentive: positiveNumber(raw.incentive ?? raw.incentives),
      otherEarnings: positiveNumber(raw.other_earnings),
      loanDeduction: positiveNumber(raw.loan_deduction),
      advanceDeduction: positiveNumber(raw.advance_deduction),
      otherDeductions: positiveNumber(raw.other_deductions ?? raw.other_deduction),
      esiApplicable: person?.esi_applicable ?? true,
      pfApplicableToPerson: person?.pf_applicable ?? false,
    }, rules);

    const { error: updErr } = await admin
      .from("payroll_entries")
      .update({
        ...computed,
        incentive_remarks: text(raw.incentive_remarks),
        remarks: text(raw.remarks),
      })
      .eq("id", entryId)
      .eq("period_id", periodId);
    if (updErr) throw updErr;
    saved++;
  }

  return json({ success: true, saved }, 200);
}

// ---------------- FINALISE ----------------
// The only step that touches the loan and advance ledgers. Whatever
// deduction is sitting in the grid is exactly what comes off the ledger.
//
// Running it twice cannot deduct twice: the sheet is claimed with a
// conditional update before anything is posted, and every posting is
// tagged with the payroll entry that caused it, so the posting pass skips
// a row it has already posted for. That also lets a half-finished
// finalise be completed by simply running it again.
async function finalise(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "payroll.finalise");
  const admin = me.admin;

  const periodId = uuidArg(body.period_id);
  if (!periodId) throw new AuthError("Missing period_id", 400);

  const { data: period, error: perErr } = await admin
    .from("payroll_periods").select("*").eq("id", periodId).maybeSingle();
  if (perErr) throw perErr;
  if (!period) throw new AuthError("Salary sheet not found", 404);
  if (period.status === "cancelled") {
    throw new AuthError("This salary sheet was cancelled and cannot be finalised.", 400);
  }

  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await admin
    .from("payroll_periods")
    .update({ status: "completed", finalised_at: nowIso, finalised_by: me.partyId })
    .eq("id", periodId).eq("status", "draft")
    .select("id");
  if (claimErr) throw claimErr;
  const wasAlreadyFinalised = (claimed ?? []).length === 0;

  const { data: entries, error: entErr } = await admin
    .from("payroll_entries").select("*").eq("period_id", periodId);
  if (entErr) throw entErr;
  const entryIds = (entries ?? []).map((e) => e.id as string);

  // What has already been posted for this sheet.
  let postedLoanEntries = new Set<string>();
  let postedAdvanceEntries = new Set<string>();
  if (entryIds.length > 0) {
    const [ltx, atx] = await Promise.all([
      admin.from("employee_loan_transactions")
        .select("payroll_entry_id, status").in("payroll_entry_id", entryIds),
      admin.from("employee_advance_transactions")
        .select("payroll_entry_id, status").in("payroll_entry_id", entryIds),
    ]);
    if (ltx.error) throw ltx.error;
    if (atx.error) throw atx.error;
    postedLoanEntries = new Set(
      (ltx.data ?? []).filter((t) => t.status !== "cancelled")
        .map((t) => t.payroll_entry_id as string),
    );
    postedAdvanceEntries = new Set(
      (atx.data ?? []).filter((t) => t.status !== "cancelled")
        .map((t) => t.payroll_entry_id as string),
    );
  }

  const periodFirst = String(period.period_month);
  const label = periodFirst.slice(0, 7);
  const closedOn = todayIST();

  const loans = await openLoans(admin, periodFirst);
  const advances = await openAdvances(admin, periodFirst);
  const loanLeft = new Map(loans.map((l) => [l.id, l.outstanding]));
  const advanceLeft = new Map(advances.map((a) => [a.id, a.outstanding]));

  let loansTouched = 0;
  let advancesTouched = 0;

  for (const entry of entries ?? []) {
    const entryId = entry.id as string;
    const partyId = entry.party_id as string;

    // --- Loan recovery ---
    let toRecover = round2(entry.loan_deduction ?? 0);
    if (toRecover > 0 && !postedLoanEntries.has(entryId)) {
      for (const loan of loans.filter((l) => l.party_id === partyId)) {
        if (toRecover <= 0) break;
        const left = loanLeft.get(loan.id) ?? 0;
        if (left <= 0) continue;
        const applied = round2(Math.min(toRecover, left));
        if (applied <= 0) continue;

        const { error } = await admin.from("employee_loan_transactions").insert({
          loan_id: loan.id,
          txn_month: periodFirst,
          txn_type: "recovery",
          amount: applied,
          payroll_entry_id: entryId,
          remarks: `Salary deduction for ${label}`,
          status: "completed",
          created_by: me.partyId,
        });
        if (error) throw error;

        const remaining = round2(left - applied);
        loanLeft.set(loan.id, remaining);
        if (remaining <= 0) {
          const { error: closeErr } = await admin.from("employee_loans")
            .update({ status: "completed", closed_on: closedOn }).eq("id", loan.id);
          if (closeErr) throw closeErr;
        }
        toRecover = round2(toRecover - applied);
        loansTouched++;
      }
    }

    // --- Advance recovery ---
    let toRecoverAdv = round2(entry.advance_deduction ?? 0);
    if (toRecoverAdv > 0 && !postedAdvanceEntries.has(entryId)) {
      for (const adv of advances.filter((a) => a.party_id === partyId)) {
        if (toRecoverAdv <= 0) break;
        const left = advanceLeft.get(adv.id) ?? 0;
        if (left <= 0) continue;
        const applied = round2(Math.min(toRecoverAdv, left));
        if (applied <= 0) continue;

        const { error } = await admin.from("employee_advance_transactions").insert({
          advance_id: adv.id,
          txn_month: periodFirst,
          txn_type: "recovery",
          amount: applied,
          payroll_entry_id: entryId,
          remarks: `Salary recovery for ${label}`,
          status: "completed",
          created_by: me.partyId,
        });
        if (error) throw error;

        const remaining = round2(left - applied);
        advanceLeft.set(adv.id, remaining);
        if (remaining <= 0) {
          const { error: closeErr } = await admin.from("employee_advances")
            .update({ status: "completed", closed_on: closedOn }).eq("id", adv.id);
          if (closeErr) throw closeErr;
        }
        // A shortfall simply stays outstanding and is suggested again next month.
        toRecoverAdv = round2(toRecoverAdv - applied);
        advancesTouched++;
      }
    }
  }

  if (entryIds.length > 0) {
    const { error: entUpd } = await admin.from("payroll_entries")
      .update({ status: "completed" }).eq("period_id", periodId).neq("status", "cancelled");
    if (entUpd) throw entUpd;
  }

  const message = wasAlreadyFinalised && loansTouched === 0 && advancesTouched === 0
    ? "This salary sheet was already finalised. Nothing was posted again."
    : `Salary sheet finalised. ${loansTouched} loan deduction${loansTouched === 1 ? "" : "s"} and ` +
      `${advancesTouched} advance recover${advancesTouched === 1 ? "y" : "ies"} posted to the ledgers.`;

  const { data: after } = await admin
    .from("payroll_periods").select("*").eq("id", periodId).maybeSingle();

  return json({
    success: true,
    message,
    already_finalised: wasAlreadyFinalised,
    loans_posted: loansTouched,
    advances_posted: advancesTouched,
    period: after ? shapePeriod(after) : null,
  }, 200);
}

// ---------------- SALARY SLIP ----------------
async function getSlip(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "payroll.view");
  const admin = me.admin;

  const entryId = uuidArg(body.entry_id);
  if (!entryId) throw new AuthError("Missing entry_id", 400);

  const { data: entry, error } = await admin
    .from("payroll_entries").select("*").eq("id", entryId).maybeSingle();
  if (error) throw error;
  if (!entry) throw new AuthError("Entry not found", 404);

  const { data: period, error: perErr } = await admin
    .from("payroll_periods").select("*").eq("id", entry.period_id).maybeSingle();
  if (perErr) throw perErr;

  const people = await loadPeople(admin, { partyIds: [entry.party_id as string] });
  const person = people.get(entry.party_id as string) ?? null;

  const { data: bank } = await admin
    .from("party_bank_accounts")
    .select("bank_name, account_number, ifsc, branch_name, is_primary, status")
    .eq("party_id", entry.party_id)
    .neq("status", "cancelled")
    .order("is_primary", { ascending: false })
    .limit(1).maybeSingle();

  const daysInMonth = Number(period?.days_in_month ?? 30);
  const slip = shapeEntry(entry, daysInMonth, {
    payroll_periods: period ? shapePeriod(period) : null,
    parties: person
      ? { display_name: person.name, party_number: person.party_number, primary_mobile: person.mobile }
      : null,
    employees: person                                        // legacy alias
      ? {
        id: person.party_id,
        name: person.name,
        employee_code: person.party_number,
        mobile_number: person.mobile,
        date_of_joining: person.date_of_joining,
        esi_number: person.esi_number,
        pf_number: person.uan_number,
        bank_name: bank?.bank_name ?? null,
        bank_account_number: bank?.account_number ?? null,
        departments: person.department ? { name: person.department } : null,
        designations: person.designation ? { name: person.designation } : null,
        branches: person.branch ? { name: person.branch } : null,
      }
      : null,
    bank: bank ?? null,
  });

  return json({ success: true, slip }, 200);
}

// ---------------- COLUMN WIDTHS ----------------
// Saved company-wide so the layout carries over to every future month.
// The old version asked for no permission at all to read these; it now
// takes payroll.view, the same as the sheet they belong to.
async function getColumnWidths(me: Caller) {
  requirePermission(me, "payroll.view");
  const { data, error } = await me.admin
    .from("app_settings").select("payroll_column_widths").eq("id", 1).maybeSingle();
  if (error) throw error;
  return json({ success: true, widths: data?.payroll_column_widths ?? null }, 200);
}

async function saveColumnWidths(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "payroll.view");
  const widths = body.widths;
  if (!widths || typeof widths !== "object" || Array.isArray(widths)) {
    throw new AuthError("Invalid widths", 400);
  }
  // Only column-name to pixel-width pairs are stored, nothing else.
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(widths as Record<string, unknown>)) {
    const n = Number(v);
    if (/^[a-z0-9_]{1,60}$/i.test(k) && isFinite(n) && n >= 20 && n <= 1000) {
      clean[k] = Math.round(n);
    }
  }
  const { error } = await me.admin
    .from("app_settings").update({ payroll_column_widths: clean }).eq("id", 1);
  if (error) throw error;
  return json({ success: true, widths: clean }, 200);
}

// ---------------- THROW AWAY A DRAFT ----------------
// Nothing is deleted. The sheet and its rows are cancelled, and the month
// can be opened again later.
async function cancelPeriod(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "payroll.finalise");
  const admin = me.admin;

  const periodId = uuidArg(body.period_id);
  if (!periodId) throw new AuthError("Missing period_id", 400);

  const { data: period, error } = await admin
    .from("payroll_periods").select("*").eq("id", periodId).maybeSingle();
  if (error) throw error;
  if (!period) throw new AuthError("Salary sheet not found", 404);
  if (period.status === "completed") {
    throw new AuthError("A finalised salary sheet cannot be cancelled.", 400);
  }
  if (period.status === "cancelled") {
    return json({ success: true, period: shapePeriod(period), already_cancelled: true }, 200);
  }

  const { error: entErr } = await admin
    .from("payroll_entries").update({ status: "cancelled" }).eq("period_id", periodId);
  if (entErr) throw entErr;

  const { data: cancelled, error: updErr } = await admin
    .from("payroll_periods")
    .update({ status: "cancelled", remarks: text(body.reason) ?? period.remarks })
    .eq("id", periodId).select().single();
  if (updErr) throw updErr;

  return json({ success: true, period: shapePeriod(cancelled) }, 200);
}

// ============================================================

Deno.serve((req) => handle(req, async () => {
  // Who is calling comes from the token and nothing else. Whatever the
  // body claims about identity is read past and thrown away.
  const me = await authenticate(req);
  requireActiveEmployee(me);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    throw new AuthError("The request could not be read.", 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!action) throw new AuthError("Missing action", 400);

  switch (action) {
    case "get_payroll_periods":
    case "list_periods":            return await listPeriods(me);

    case "create_payroll_period":
    case "create_period":           return await createPeriod(me, body);

    case "get_payroll_sheet":
    case "load_sheet":              return await loadSheet(me, body);

    case "save_payroll_entries":
    case "save_sheet":              return await saveSheet(me, body);

    case "finalise_payroll":
    case "finalise":                return await finalise(me, body);

    case "get_salary_slip":
    case "get_slip":                return await getSlip(me, body);

    case "get_column_widths":       return await getColumnWidths(me);
    case "save_column_widths":      return await saveColumnWidths(me, body);

    case "delete_payroll_period":
    case "cancel_payroll_period":
    case "cancel_period":           return await cancelPeriod(me, body);

    default:
      throw new AuthError("Unknown action", 400);
  }
}));
