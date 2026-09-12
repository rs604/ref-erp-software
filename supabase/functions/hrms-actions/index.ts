// ============================================================
// hrms-actions — Holidays, and Loans & Advances.
//
// What changed from Tokyo, and why:
//
//  1. IDENTITY. The old version read `requester_id` out of the request
//     body and believed it. Anyone who knew a UUID could act as that
//     person. There is no `requester_id` in this file. The caller comes
//     only from `authenticate(req)`, which reads the signed token. An
//     identity field arriving in the body is read past and thrown away.
//
//  2. PERMISSION. Every action asks for the one key it needs --
//     holidays.view/.create/.edit/.delete, loans_advances.view/.create/
//     .edit/.approve, admin.settings. Owner passes everything; the
//     shared helper handles that.
//
//  3. SHAPE. The employee is now `parties` + `employee_details` +
//     `party_roles`. Loans and advances hang off `party_id`.
//
//  4. BALANCES ARE NEVER STORED. There is deliberately no "outstanding"
//     column. `public.loan_balances` and `public.advance_balances` are
//     the only source, and they add the ledger up on every read. This
//     file reads them and writes ledger rows; it never writes a balance.
//
//  5. STATUS WORDS. draft -> submitted -> approved -> completed, plus
//     cancelled. A fully recovered loan is `completed`. Nothing is ever
//     deleted; retiring is `status = 'cancelled'`.
//     The screen has not been rewritten yet, so every reply carries the
//     old field names it reads (`holiday_name`, `calendar_year`,
//     `is_active`, `principal_amount`, `balance`, `outstanding`,
//     `employees.name`, ...) beside the real new ones, and a
//     `legacy_status` beside the real one.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate, handle, json, requireActiveEmployee, requirePermission,
  AuthError, type Caller,
} from "../_shared/auth.ts";

// ---------- small helpers ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid the caller sent us. Only ever names a *row*, never a person's rights. */
function uuidArg(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && UUID_RE.test(c)) return c;
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function money(v: unknown): number | null {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Number(n.toFixed(2));
}

/** Today in India, which is the day the office is actually having. */
function today(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split("T")[0];
}

/** 'YYYY-MM' or 'YYYY-MM-DD' -> the first of that month. */
function monthStart(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const m = c.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-01`;
  }
  return null;
}

/** A date column handed back to the screen as the 'YYYY-MM' it expects. */
function asPeriod(dateStr: unknown): string | null {
  return typeof dateStr === "string" && dateStr.length >= 7 ? dateStr.slice(0, 7) : null;
}

function addMonths(monthStartStr: string, n: number): string {
  const [y, m] = monthStartStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().split("T")[0];
}

function yearOf(dateStr: string): number {
  return Number(dateStr.slice(0, 4));
}

// ---------- status words ----------
// The database speaks the shared vocabulary. The screen still speaks the
// old Tokyo words for these two ledgers. Translate both ways so neither
// has to change today.
const OPEN_STATES = ["draft", "submitted", "approved"];

function legacyLoanStatus(s: string): string {
  if (s === "completed") return "closed";
  if (s === "cancelled") return "cancelled";
  return "active";
}
function legacyAdvanceStatus(s: string): string {
  if (s === "completed") return "recovered";
  if (s === "cancelled") return "cancelled";
  return "outstanding";
}
/** Accepts either vocabulary for a loan/advance, returns the stored word. */
function toStoredStatus(word: unknown): string | null {
  const w = str(word);
  if (["draft", "submitted", "approved", "completed", "cancelled"].includes(w)) return w;
  if (w === "active") return "approved";
  if (w === "closed" || w === "recovered") return "completed";
  return null;
}

// ============================================================
//  HOLIDAYS
// ============================================================

// The nine standard company holidays. Four fall on a fixed date every
// year. Five follow the lunar calendar, so no reliable free source gives
// their date in advance -- they are created with NO DATE and the user
// fills it in. A silently wrong payroll date is far worse than a
// five-minute manual step.
const FIXED_HOLIDAYS = [
  { key: "guru_gobind_singh_jayanti", name: "Guru Gobind Singh Jayanti", month: 1, day: 5, type: "Festival Holiday" },
  { key: "republic_day", name: "Republic Day", month: 1, day: 26, type: "National Holiday" },
  { key: "independence_day", name: "Independence Day", month: 8, day: 15, type: "National Holiday" },
  { key: "gandhi_jayanti", name: "Gandhi Jayanti", month: 10, day: 2, type: "National Holiday" },
];
const LUNAR_HOLIDAYS = [
  { key: "holi", name: "Holi" },
  { key: "dussehra", name: "Dussehra" },
  { key: "diwali", name: "Diwali" },
  { key: "vishwakarma_day", name: "Vishwakarma Day" },
  { key: "guru_nanak_jayanti", name: "Guru Nanak Dev Jayanti" },
];

// `holidays` has no template_key column, and it does not need one: the
// nine standard names are fixed, so the key is worked out from the name.
const TEMPLATE_BY_NAME = new Map<string, string>(
  [...FIXED_HOLIDAYS, ...LUNAR_HOLIDAYS].map((h) => [h.name.toLowerCase(), h.key]),
);
function templateKeyOf(name: unknown): string | null {
  return TEMPLATE_BY_NAME.get(str(name).toLowerCase()) ?? null;
}

/** One holiday row, in both vocabularies. */
function shapeHoliday(h: Record<string, unknown>) {
  return {
    ...h,
    holiday_name: h.name,                          // legacy alias
    calendar_year: h.holiday_year,                 // legacy alias
    is_active: h.status === "approved",            // legacy alias
    is_full_day: true,                             // no half-day holidays in the new shape
    template_key: templateKeyOf(h.name),           // worked out, not stored
  };
}

async function holidayTypeIds(admin: Caller["admin"]): Promise<Map<string, string>> {
  const { data } = await admin
    .from("holiday_types").select("id, name").eq("status", "approved");
  return new Map((data ?? []).map((t) => [String(t.name).toLowerCase(), t.id as string]));
}

async function getHolidaysData(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "holidays.view");
  const admin = me.admin;

  const yearRaw = body.holiday_year ?? body.calendar_year;
  const year = yearRaw === undefined || yearRaw === null || yearRaw === "" ? null : Number(yearRaw);
  if (year !== null && (!isFinite(year) || year < 2000 || year > 2100)) {
    throw new AuthError("That is not a year we can use.", 400);
  }

  let q = admin
    .from("holidays")
    .select("*, holiday_types(name), branches(name)")
    .order("holiday_date", { ascending: true, nullsFirst: true });
  if (year !== null) q = q.eq("holiday_year", year);

  const [holidaysRes, typesRes, branchesRes] = await Promise.all([
    q,
    admin.from("holiday_types").select("*").eq("status", "approved").order("name"),
    admin.from("branches").select("id, name, status").eq("status", "approved").order("name"),
  ]);
  if (holidaysRes.error) throw holidaysRes.error;
  if (typesRes.error) throw typesRes.error;
  if (branchesRes.error) throw branchesRes.error;

  const { data: years } = await admin
    .from("holidays").select("holiday_year").order("holiday_year", { ascending: false });

  return json({
    success: true,
    holidays: (holidaysRes.data ?? []).map(shapeHoliday),
    holidayTypes: (typesRes.data ?? []).map((t) => ({ ...t, is_active: t.status === "approved" })),
    branches: (branchesRes.data ?? []).map((b) => ({ ...b, is_active: b.status === "approved" })),
    years: [...new Set((years ?? []).map((r) => r.holiday_year as number))],
  }, 200);
}

async function generateYearlyHolidays(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "holidays.create");
  const admin = me.admin;

  const year = Number(body.holiday_year ?? body.calendar_year);
  if (!isFinite(year) || year < 2000 || year > 2100) {
    throw new AuthError("Please provide a valid year, e.g. 2026.", 400);
  }

  const { data: existing, error: exErr } = await admin
    .from("holidays").select("name").eq("holiday_year", year);
  if (exErr) throw exErr;
  const taken = new Set((existing ?? []).map((r) => templateKeyOf(r.name)).filter(Boolean));

  const types = await holidayTypeIds(admin);
  const festivalType = types.get("festival holiday") ?? null;

  const toInsert: Record<string, unknown>[] = [];
  for (const f of FIXED_HOLIDAYS) {
    if (taken.has(f.key)) continue;
    toInsert.push({
      name: f.name,
      holiday_date: `${year}-${String(f.month).padStart(2, "0")}-${String(f.day).padStart(2, "0")}`,
      holiday_year: year,
      holiday_type_id: types.get(f.type.toLowerCase()) ?? null,
      branch_id: null,
      is_optional: false,
      status: "approved",
      created_by: me.partyId,
    });
  }
  for (const f of LUNAR_HOLIDAYS) {
    if (taken.has(f.key)) continue;
    // No date. The lunar calendar decides it, and a human enters it.
    toInsert.push({
      name: f.name,
      holiday_date: null,
      holiday_year: year,
      holiday_type_id: festivalType,
      branch_id: null,
      is_optional: false,
      status: "approved",
      created_by: me.partyId,
    });
  }

  if (toInsert.length === 0) {
    return json({
      success: true, created: 0, pending_dates: 0, holidays: [],
      message: `All standard holidays already exist for ${year}.`,
    }, 200);
  }

  const { data, error } = await admin.from("holidays").insert(toInsert).select();
  if (error) throw error;

  const pending = toInsert.filter((h) => !h.holiday_date).length;
  return json({
    success: true,
    created: toInsert.length,
    pending_dates: pending,
    holidays: (data ?? []).map(shapeHoliday),
    message: `Created ${toInsert.length} holidays for ${year}. ${pending} festival date${
      pending === 1 ? "" : "s"} still need${pending === 1 ? "s" : ""} to be filled in.`,
  }, 200);
}

async function createHoliday(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "holidays.create");
  const admin = me.admin;

  const h = (body.holiday ?? {}) as Record<string, unknown>;
  const name = str(h.holiday_name) || str(h.name);
  if (!name) throw new AuthError("Holiday Name is required.", 400);

  const date = str(h.holiday_date) || null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AuthError("That holiday date could not be read.", 400);
  }
  const year = Number(h.holiday_year ?? h.calendar_year) || (date ? yearOf(date) : NaN);
  if (!isFinite(year)) {
    throw new AuthError("A holiday with no date still needs the year it belongs to.", 400);
  }

  const branchId = uuidArg(h.branch_id);
  const typeId = uuidArg(h.holiday_type_id);

  // Block an exact duplicate: same date, same branch scope, still in use.
  if (date) {
    let dupe = admin.from("holidays").select("id, name")
      .eq("holiday_date", date).eq("status", "approved");
    dupe = branchId ? dupe.eq("branch_id", branchId) : dupe.is("branch_id", null);
    const { data: clash } = await dupe.maybeSingle();
    if (clash) {
      throw new AuthError(
        `A holiday already exists on this date for this branch: "${clash.name}".`, 409);
    }
  }

  const { data, error } = await admin.from("holidays").insert({
    name,
    holiday_date: date,
    holiday_year: year,
    holiday_type_id: typeId,
    branch_id: branchId,
    is_optional: h.is_optional === true,
    remarks: str(h.remarks) || null,
    status: "approved",
    created_by: me.partyId,
  }).select("*, holiday_types(name), branches(name)").single();
  if (error) throw error;

  return json({ success: true, holiday: shapeHoliday(data) }, 200);
}

async function updateHoliday(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "holidays.edit");
  const admin = me.admin;

  const id = uuidArg(body.holiday_id);
  if (!id) throw new AuthError("Missing holiday_id", 400);

  const h = (body.holiday ?? {}) as Record<string, unknown>;
  const name = str(h.holiday_name) || str(h.name);
  if (!name) throw new AuthError("Holiday Name is required.", 400);

  const patch: Record<string, unknown> = {
    name,
    holiday_type_id: uuidArg(h.holiday_type_id),
    branch_id: uuidArg(h.branch_id),
    is_optional: h.is_optional === true,
  };
  if (h.remarks !== undefined) patch.remarks = str(h.remarks) || null;

  const newDate = str(h.holiday_date);
  if (newDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      throw new AuthError("That holiday date could not be read.", 400);
    }
    patch.holiday_date = newDate;
    patch.holiday_year = Number(h.holiday_year ?? h.calendar_year) || yearOf(newDate);
  }

  const { data, error } = await admin
    .from("holidays").update(patch).eq("id", id)
    .select("*, holiday_types(name), branches(name)").single();
  if (error) throw error;

  // Vishwakarma Day is always the day after Diwali (company rule), so
  // setting Diwali's date fills it in -- unless somebody already did.
  let auto_filled: { name: string; date: string } | null = null;
  if (newDate && templateKeyOf(data.name) === "diwali") {
    const { data: siblings } = await admin
      .from("holidays").select("id, name, holiday_date")
      .eq("holiday_year", data.holiday_year).eq("status", "approved");
    const vish = (siblings ?? []).find((s) => templateKeyOf(s.name) === "vishwakarma_day");
    if (vish && !vish.holiday_date) {
      const d = new Date(`${newDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      const nextDay = d.toISOString().split("T")[0];
      await admin.from("holidays")
        .update({ holiday_date: nextDay, holiday_year: yearOf(nextDay) })
        .eq("id", vish.id);
      auto_filled = { name: "Vishwakarma Day", date: nextDay };
    }
  }

  return json({ success: true, holiday: shapeHoliday(data), auto_filled }, 200);
}

/** Retire a holiday, or put a retired one back. Nothing is deleted. */
async function toggleHolidayStatus(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "holidays.delete");
  const admin = me.admin;

  const id = uuidArg(body.holiday_id);
  if (!id) throw new AuthError("Missing holiday_id", 400);

  // The screen sends is_active; the database stores approved/cancelled.
  const wanted = body.status !== undefined
    ? (str(body.status) === "approved" ? "approved" : "cancelled")
    : (body.is_active === true ? "approved" : "cancelled");

  const { data, error } = await admin
    .from("holidays").update({ status: wanted }).eq("id", id)
    .select("*, holiday_types(name), branches(name)").single();
  if (error) throw error;

  return json({ success: true, holiday: shapeHoliday(data) }, 200);
}

async function addHolidayType(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "holidays.create");
  const name = str(body.name);
  if (!name) throw new AuthError("Name is required.", 400);

  const { data: existing } = await me.admin
    .from("holiday_types").select("id, name, status").ilike("name", name).maybeSingle();
  if (existing) {
    if (existing.status === "approved") {
      throw new AuthError(`"${existing.name}" is already on the list.`, 409);
    }
    const { data: revived, error: revErr } = await me.admin
      .from("holiday_types").update({ status: "approved" }).eq("id", existing.id).select().single();
    if (revErr) throw revErr;
    return json({ success: true, item: { ...revived, is_active: true } }, 200);
  }

  const { data, error } = await me.admin
    .from("holiday_types")
    .insert({ name, status: "approved", created_by: me.partyId })
    .select().single();
  if (error) throw error;
  return json({ success: true, item: { ...data, is_active: true } }, 200);
}

async function toggleHolidayType(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "holidays.edit");
  const id = uuidArg(body.id, body.holiday_type_id);
  if (!id) throw new AuthError("Missing id", 400);

  const wanted = body.status !== undefined
    ? (str(body.status) === "approved" ? "approved" : "cancelled")
    : (body.is_active === true ? "approved" : "cancelled");

  const { data, error } = await me.admin
    .from("holiday_types").update({ status: wanted }).eq("id", id).select().single();
  if (error) throw error;
  return json({ success: true, item: { ...data, is_active: data.status === "approved" } }, 200);
}

// ============================================================
//  people, for the two ledgers
// ============================================================

async function peopleByIds(admin: Caller["admin"], ids: string[]) {
  const out = new Map<string, { name: string; party_number: string | null }>();
  const wanted = [...new Set(ids)].filter(Boolean);
  if (wanted.length === 0) return out;
  const { data } = await admin
    .from("parties").select("id, display_name, party_number").in("id", wanted);
  for (const p of data ?? []) {
    out.set(p.id as string, {
      name: p.display_name as string,
      party_number: (p.party_number as string) ?? null,
    });
  }
  return out;
}

function personBlock(person: { name: string; party_number: string | null } | undefined) {
  if (!person) return { employees: null, parties: null };
  return {
    // legacy alias -- the screen still reads `employees.name`
    employees: { name: person.name, employee_code: person.party_number },
    parties: { display_name: person.name, party_number: person.party_number },
  };
}

/** Confirms the person named actually is somebody on the books. */
async function requireEmployeeParty(admin: Caller["admin"], partyId: string) {
  const { data: party } = await admin
    .from("parties").select("id, display_name, status").eq("id", partyId).maybeSingle();
  if (!party || party.status === "cancelled") {
    throw new AuthError("That employee was not found.", 404);
  }
  const { data: roles } = await admin
    .from("party_roles").select("role").eq("party_id", partyId).eq("status", "approved");
  if (!(roles ?? []).some((r) => r.role === "employee" || r.role === "owner")) {
    throw new AuthError("That person is not an employee.", 400);
  }
  return party;
}

// ============================================================
//  LOANS
//  Money lent to an employee, recovered over several months.
//  The balance lives in `loan_balances` and nowhere else.
// ============================================================

async function getLoansData(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "loans_advances.view");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);

  let q = admin.from("employee_loans").select("*").order("loan_date", { ascending: false });
  if (partyId) q = q.eq("party_id", partyId);
  const { data: loans, error } = await q;
  if (error) throw error;

  const ids = (loans ?? []).map((l) => l.id as string);

  // The only correct source of a balance. Never recomputed here, never stored.
  const { data: balances, error: balErr } = ids.length
    ? await admin.from("loan_balances").select("*").in("loan_id", ids)
    : { data: [], error: null };
  if (balErr) throw balErr;
  const balByLoan = new Map((balances ?? []).map((b) => [b.loan_id as string, b]));

  const { data: txns, error: txnErr } = ids.length
    ? await admin.from("employee_loan_transactions").select("*").in("loan_id", ids)
        .order("txn_month", { ascending: true })
    : { data: [], error: null };
  if (txnErr) throw txnErr;

  const people = await peopleByIds(admin, (loans ?? []).map((l) => l.party_id as string));

  const shaped = (loans ?? []).map((l) => {
    const bal = balByLoan.get(l.id as string);
    const mine = (txns ?? []).filter((t) => t.loan_id === l.id).map(shapeLoanTxn);
    return {
      ...l,
      ...personBlock(people.get(l.party_id as string)),
      employee_id: l.party_id,                          // legacy alias
      principal_amount: l.principal,                    // legacy alias
      disbursed_on: l.loan_date,                        // legacy alias
      monthly_deduction: l.instalment_amount,           // legacy alias
      total_installments: l.instalment_count,           // legacy alias
      legacy_status: legacyLoanStatus(l.status as string),
      transactions: mine,
      recovered: Number(bal?.recovered ?? 0),
      waived: Number(bal?.waived ?? 0),
      adjusted: Number(bal?.adjusted ?? 0),
      outstanding: Number(bal?.outstanding ?? l.principal),
      total_repaid: Number(bal?.recovered ?? 0),        // legacy alias
      balance: Number(bal?.outstanding ?? l.principal), // legacy alias
    };
  });

  return json({ success: true, loans: shaped }, 200);
}

function shapeLoanTxn(t: Record<string, unknown>) {
  return {
    ...t,
    txn_date: t.txn_month,                 // legacy alias
    payroll_period: asPeriod(t.txn_month), // legacy alias
    notes: t.remarks,                      // legacy alias
  };
}

async function createLoan(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "loans_advances.create");
  const admin = me.admin;

  const l = (body.loan ?? {}) as Record<string, unknown>;
  const partyId = uuidArg(l.party_id, l.employee_id);
  if (!partyId) throw new AuthError("Employee is required.", 400);
  await requireEmployeeParty(admin, partyId);

  const principal = money(l.principal ?? l.principal_amount ?? l.amount);
  if (principal === null || principal <= 0) {
    throw new AuthError("Amount must be greater than zero.", 400);
  }

  const loanDate = str(l.loan_date) || str(l.disbursed_on) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(loanDate)) {
    throw new AuthError("Disbursed On date is required.", 400);
  }

  // Either a fixed monthly amount or a number of instalments. The one not
  // given is worked out from the other; both are terms of the loan, not a
  // balance, so storing them is right.
  let instalment = money(l.instalment_amount ?? l.monthly_deduction);
  let count = Number(l.instalment_count ?? l.total_installments);
  if (!isFinite(count) || count <= 0) count = NaN;

  if ((instalment === null || instalment <= 0) && !isFinite(count)) {
    throw new AuthError(
      "Provide either a Monthly Deduction amount or a number of Instalments.", 400);
  }
  if (instalment !== null && instalment > principal) {
    throw new AuthError("Monthly deduction cannot exceed the total amount.", 400);
  }
  if (instalment === null || instalment <= 0) {
    instalment = Number((principal / count).toFixed(2));
  }
  if (!isFinite(count)) {
    count = Math.ceil(principal / instalment);
  }

  const firstRecovery = monthStart(l.first_recovery_month, l.payroll_period)
    ?? addMonths(monthStart(loanDate)!, 1);

  const { data: docNumber, error: numErr } = await admin
    .rpc("next_human_number", { p_series_key: "loan" });
  if (numErr) throw numErr;

  // Whoever may approve, approves as they record it -- and the money going
  // out is written into the ledger there and then. Anyone else leaves it
  // submitted for someone who can approve.
  const canApprove = me.isOwner || me.permissions.includes("loans_advances.approve");

  const { data: loan, error } = await admin.from("employee_loans").insert({
    document_number: docNumber,
    party_id: partyId,
    loan_date: loanDate,
    principal,
    instalment_amount: instalment,
    instalment_count: count,
    first_recovery_month: firstRecovery,
    reason: str(l.reason) || null,
    status: canApprove ? "approved" : "submitted",
    approved_by: canApprove ? me.partyId : null,
    approved_on: canApprove ? new Date().toISOString() : null,
    created_by: me.partyId,
  }).select().single();
  if (error) throw error;

  if (canApprove) await writeDisbursement(me, "loan", loan.id as string, principal, loanDate);

  return json({ success: true, loan: await oneLoan(me, loan.id as string) }, 200);
}

async function updateLoan(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "loans_advances.edit");
  const admin = me.admin;

  const id = uuidArg(body.loan_id, body.id);
  if (!id) throw new AuthError("Missing loan_id", 400);

  const { data: loan } = await admin
    .from("employee_loans").select("*").eq("id", id).maybeSingle();
  if (!loan) throw new AuthError("Loan not found.", 404);
  if (loan.status === "completed" || loan.status === "cancelled") {
    throw new AuthError("A closed or cancelled loan cannot be edited.", 400);
  }

  const l = (body.loan ?? body) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  const instalment = money(l.instalment_amount ?? l.monthly_deduction);
  if (instalment !== null && instalment > 0) patch.instalment_amount = instalment;

  const count = Number(l.instalment_count ?? l.total_installments);
  if (isFinite(count) && count > 0) patch.instalment_count = Math.round(count);

  const firstRecovery = monthStart(l.first_recovery_month);
  if (firstRecovery) patch.first_recovery_month = firstRecovery;

  const loanDate = str(l.loan_date) || str(l.disbursed_on);
  if (loanDate) patch.loan_date = loanDate;

  if (l.reason !== undefined) patch.reason = str(l.reason) || null;

  // The principal may only be corrected while nothing has been recovered.
  const principal = money(l.principal ?? l.principal_amount);
  if (principal !== null && principal !== Number(loan.principal)) {
    if (principal <= 0) throw new AuthError("Amount must be greater than zero.", 400);
    const { data: bal } = await admin
      .from("loan_balances").select("recovered").eq("loan_id", id).maybeSingle();
    if (Number(bal?.recovered ?? 0) > 0) {
      throw new AuthError(
        "Money has already been recovered against this loan, so the amount cannot be changed. Record an adjustment instead.",
        400,
      );
    }
    patch.principal = principal;
  }

  if (Object.keys(patch).length === 0) throw new AuthError("Nothing to update.", 400);

  const { error } = await admin.from("employee_loans").update(patch).eq("id", id);
  if (error) throw error;

  return json({ success: true, loan: await oneLoan(me, id) }, 200);
}

/** The money going out, written as a ledger row. It is not a recovery, so
 *  the balance views ignore it -- it is there so the ledger reads whole. */
async function writeDisbursement(
  me: Caller, kind: "loan" | "advance", parentId: string, amount: number, onDate: string,
) {
  const table = kind === "loan" ? "employee_loan_transactions" : "employee_advance_transactions";
  const fk = kind === "loan" ? "loan_id" : "advance_id";
  const { error } = await me.admin.from(table).insert({
    [fk]: parentId,
    txn_month: monthStart(onDate)!,
    txn_type: "disbursement",
    amount,
    remarks: kind === "loan" ? "Loan disbursed" : "Advance paid",
    status: "completed",
    created_by: me.partyId,
  });
  if (error) throw error;
}

async function oneLoan(me: Caller, id: string) {
  const { data: loan } = await me.admin
    .from("employee_loans").select("*").eq("id", id).maybeSingle();
  if (!loan) throw new AuthError("Loan not found.", 404);
  const { data: bal } = await me.admin
    .from("loan_balances").select("*").eq("loan_id", id).maybeSingle();
  const { data: txns } = await me.admin
    .from("employee_loan_transactions").select("*").eq("loan_id", id)
    .order("txn_month", { ascending: true });
  const people = await peopleByIds(me.admin, [loan.party_id as string]);
  return {
    ...loan,
    ...personBlock(people.get(loan.party_id as string)),
    employee_id: loan.party_id,
    principal_amount: loan.principal,
    disbursed_on: loan.loan_date,
    monthly_deduction: loan.instalment_amount,
    total_installments: loan.instalment_count,
    legacy_status: legacyLoanStatus(loan.status as string),
    transactions: (txns ?? []).map(shapeLoanTxn),
    recovered: Number(bal?.recovered ?? 0),
    waived: Number(bal?.waived ?? 0),
    adjusted: Number(bal?.adjusted ?? 0),
    outstanding: Number(bal?.outstanding ?? loan.principal),
    total_repaid: Number(bal?.recovered ?? 0),
    balance: Number(bal?.outstanding ?? loan.principal),
  };
}

/**
 * A recovery, waiver or adjustment against a loan. This is the only way a
 * loan's balance ever moves: a row goes into the ledger and the view adds
 * it up. When the outstanding reaches zero the loan becomes `completed`.
 */
async function addLoanTransaction(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "loans_advances.edit");
  const admin = me.admin;

  const loanId = uuidArg(body.loan_id);
  if (!loanId) throw new AuthError("Missing loan_id", 400);

  const t = (body.txn ?? body.transaction ?? body) as Record<string, unknown>;
  const amount = money(t.amount);
  if (amount === null || amount <= 0) throw new AuthError("Amount must be greater than zero.", 400);

  const txnMonth = monthStart(t.txn_month, t.payroll_period, t.txn_date) ?? monthStart(today())!;

  // The screen's word for a salary deduction is 'deduction'; the database
  // calls it 'recovery'. Anything unrecognised is treated as a recovery.
  const rawType = str(t.txn_type);
  const txnType = rawType === "waiver" || rawType === "adjustment" || rawType === "disbursement"
    ? rawType
    : "recovery";

  const { data: loan } = await admin
    .from("employee_loans").select("*").eq("id", loanId).maybeSingle();
  if (!loan) throw new AuthError("Loan not found.", 404);
  if (!OPEN_STATES.includes(loan.status as string)) {
    throw new AuthError("This loan is already closed or cancelled.", 400);
  }
  if (loan.status !== "approved" && txnType !== "disbursement") {
    throw new AuthError("This loan has not been approved yet.", 400);
  }

  const { data: before, error: balErr } = await admin
    .from("loan_balances").select("outstanding").eq("loan_id", loanId).maybeSingle();
  if (balErr) throw balErr;
  const outstanding = Number(before?.outstanding ?? loan.principal);

  if ((txnType === "recovery" || txnType === "waiver") && amount > outstanding + 0.005) {
    throw new AuthError(`This exceeds the outstanding balance of ${outstanding.toFixed(2)}.`, 400);
  }

  const payrollEntryId = uuidArg(t.payroll_entry_id);

  const { data: txn, error } = await admin.from("employee_loan_transactions").insert({
    loan_id: loanId,
    txn_month: txnMonth,
    txn_type: txnType,
    amount,
    payroll_entry_id: payrollEntryId,
    remarks: str(t.remarks) || str(t.notes) || null,
    status: "completed",
    created_by: me.partyId,
  }).select().single();
  if (error) throw error;

  // Read the balance back from the view. Nothing is stored.
  const { data: after } = await admin
    .from("loan_balances").select("outstanding").eq("loan_id", loanId).maybeSingle();
  const remaining = Number(after?.outstanding ?? 0);
  const fullyRepaid = remaining <= 0.005;

  if (fullyRepaid) {
    await admin.from("employee_loans")
      .update({ status: "completed", closed_on: txnMonth }).eq("id", loanId);
  }

  return json({
    success: true,
    transaction: shapeLoanTxn(txn),
    outstanding: remaining,
    fully_repaid: fullyRepaid,
    loan: await oneLoan(me, loanId),
  }, 200);
}

/** Approve, close or cancel a loan. Closing is a status, never a delete. */
async function updateLoanStatus(me: Caller, body: Record<string, unknown>, forced?: string) {
  requirePermission(me, "loans_advances.approve");
  const admin = me.admin;

  const loanId = uuidArg(body.loan_id, body.id);
  if (!loanId) throw new AuthError("Missing loan_id", 400);

  const wanted = forced ?? toStoredStatus(body.new_status ?? body.status);
  if (!wanted || !["approved", "completed", "cancelled"].includes(wanted)) {
    throw new AuthError("That is not a status a loan can be moved to.", 400);
  }

  const { data: loan } = await admin
    .from("employee_loans").select("*").eq("id", loanId).maybeSingle();
  if (!loan) throw new AuthError("Loan not found.", 404);
  if (loan.status === wanted) {
    return json({ success: true, loan: await oneLoan(me, loanId) }, 200);
  }
  if (loan.status === "cancelled") {
    throw new AuthError("This loan was cancelled and cannot be reopened.", 400);
  }

  const patch: Record<string, unknown> = { status: wanted };
  if (wanted === "approved") {
    if (loan.status === "completed") {
      throw new AuthError("This loan is already closed.", 400);
    }
    patch.approved_by = me.partyId;
    patch.approved_on = new Date().toISOString();
    patch.closed_on = null;
  } else {
    patch.closed_on = today();
  }

  const { error } = await admin.from("employee_loans").update(patch).eq("id", loanId);
  if (error) throw error;

  // Approving is when the money goes out, so the ledger gets its row --
  // once, never twice.
  if (wanted === "approved") {
    const { data: already } = await admin
      .from("employee_loan_transactions").select("id")
      .eq("loan_id", loanId).eq("txn_type", "disbursement").limit(1);
    if (!already || already.length === 0) {
      await writeDisbursement(
        me, "loan", loanId, Number(loan.principal), String(loan.loan_date));
    }
  }

  return json({ success: true, loan: await oneLoan(me, loanId) }, 200);
}

// ============================================================
//  ADVANCES
//  Salary paid early, recovered from that month's salary. Whatever that
//  month could not cover carries into the next month -- and the ledger
//  rows are what show it happening.
// ============================================================

function shapeAdvanceTxn(t: Record<string, unknown>) {
  return {
    ...t,
    txn_date: t.txn_month,                 // legacy alias
    payroll_period: asPeriod(t.txn_month), // legacy alias
    notes: t.remarks,                      // legacy alias
  };
}

function shapeAdvance(
  a: Record<string, unknown>,
  bal: Record<string, unknown> | undefined,
  txns: Record<string, unknown>[],
  person: { name: string; party_number: string | null } | undefined,
) {
  const recoveries = txns.filter((t) => t.txn_type === "recovery");
  return {
    ...a,
    ...personBlock(person),
    employee_id: a.party_id,                              // legacy alias
    payroll_period: asPeriod(a.recovery_month),           // legacy alias
    notes: a.reason,                                      // legacy alias
    legacy_status: legacyAdvanceStatus(a.status as string),
    transactions: txns.map(shapeAdvanceTxn),
    recovered: Number(bal?.recovered ?? 0),
    recovered_amount: Number(bal?.recovered ?? 0),        // legacy alias
    outstanding: Number(bal?.outstanding ?? a.amount),
    // Carried forward is not a stored flag: it is simply true once the
    // recovery month has moved past the month the advance was given in,
    // which only happens when a month could not cover it.
    carried_forward: String(a.recovery_month).slice(0, 7) > String(a.advance_date).slice(0, 7)
      && recoveries.length > 0,
  };
}

async function getAdvancesData(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "loans_advances.view");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);

  let q = admin.from("employee_advances").select("*").order("advance_date", { ascending: false });
  if (partyId) q = q.eq("party_id", partyId);
  const { data: advances, error } = await q;
  if (error) throw error;

  const ids = (advances ?? []).map((a) => a.id as string);

  const { data: balances, error: balErr } = ids.length
    ? await admin.from("advance_balances").select("*").in("advance_id", ids)
    : { data: [], error: null };
  if (balErr) throw balErr;
  const balById = new Map((balances ?? []).map((b) => [b.advance_id as string, b]));

  const { data: txns, error: txnErr } = ids.length
    ? await admin.from("employee_advance_transactions").select("*").in("advance_id", ids)
        .order("txn_month", { ascending: true })
    : { data: [], error: null };
  if (txnErr) throw txnErr;

  const people = await peopleByIds(admin, (advances ?? []).map((a) => a.party_id as string));

  const shaped = (advances ?? []).map((a) => shapeAdvance(
    a,
    balById.get(a.id as string),
    (txns ?? []).filter((t) => t.advance_id === a.id),
    people.get(a.party_id as string),
  ));

  return json({ success: true, advances: shaped }, 200);
}

async function oneAdvance(me: Caller, id: string) {
  const { data: adv } = await me.admin
    .from("employee_advances").select("*").eq("id", id).maybeSingle();
  if (!adv) throw new AuthError("Advance not found.", 404);
  const { data: bal } = await me.admin
    .from("advance_balances").select("*").eq("advance_id", id).maybeSingle();
  const { data: txns } = await me.admin
    .from("employee_advance_transactions").select("*").eq("advance_id", id)
    .order("txn_month", { ascending: true });
  const people = await peopleByIds(me.admin, [adv.party_id as string]);
  return shapeAdvance(adv, bal ?? undefined, txns ?? [], people.get(adv.party_id as string));
}

async function createAdvance(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "loans_advances.create");
  const admin = me.admin;

  const a = (body.advance ?? {}) as Record<string, unknown>;
  const partyId = uuidArg(a.party_id, a.employee_id);
  if (!partyId) throw new AuthError("Employee is required.", 400);
  await requireEmployeeParty(admin, partyId);

  const amount = money(a.amount);
  if (amount === null || amount <= 0) throw new AuthError("Amount must be greater than zero.", 400);

  const advanceDate = str(a.advance_date) || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(advanceDate)) {
    throw new AuthError("Given On date is required.", 400);
  }

  const recoveryMonth = monthStart(a.recovery_month, a.payroll_period) ?? monthStart(advanceDate)!;

  const { data: docNumber, error: numErr } = await admin
    .rpc("next_human_number", { p_series_key: "advance" });
  if (numErr) throw numErr;

  const canApprove = me.isOwner || me.permissions.includes("loans_advances.approve");

  const { data: adv, error } = await admin.from("employee_advances").insert({
    document_number: docNumber,
    party_id: partyId,
    advance_date: advanceDate,
    amount,
    recovery_month: recoveryMonth,
    reason: str(a.reason) || str(a.notes) || null,
    status: canApprove ? "approved" : "submitted",
    approved_by: canApprove ? me.partyId : null,
    approved_on: canApprove ? new Date().toISOString() : null,
    created_by: me.partyId,
  }).select().single();
  if (error) throw error;

  if (canApprove) {
    await writeDisbursement(me, "advance", adv.id as string, amount, advanceDate);
  }

  return json({ success: true, advance: await oneAdvance(me, adv.id as string) }, 200);
}

async function updateAdvance(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "loans_advances.edit");
  const admin = me.admin;

  const id = uuidArg(body.advance_id, body.id);
  if (!id) throw new AuthError("Missing advance_id", 400);

  const { data: adv } = await admin
    .from("employee_advances").select("*").eq("id", id).maybeSingle();
  if (!adv) throw new AuthError("Advance not found.", 404);
  if (adv.status === "completed" || adv.status === "cancelled") {
    throw new AuthError("A recovered or cancelled advance cannot be edited.", 400);
  }

  const a = (body.advance ?? body) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  const advanceDate = str(a.advance_date);
  if (advanceDate) patch.advance_date = advanceDate;

  const recoveryMonth = monthStart(a.recovery_month, a.payroll_period, a.carry_forward_period);
  if (recoveryMonth) patch.recovery_month = recoveryMonth;

  if (a.reason !== undefined || a.notes !== undefined) {
    patch.reason = str(a.reason) || str(a.notes) || null;
  }

  const amount = money(a.amount);
  if (amount !== null && amount !== Number(adv.amount)) {
    if (amount <= 0) throw new AuthError("Amount must be greater than zero.", 400);
    const { data: bal } = await admin
      .from("advance_balances").select("recovered").eq("advance_id", id).maybeSingle();
    if (Number(bal?.recovered ?? 0) > 0) {
      throw new AuthError(
        "Money has already been recovered against this advance, so the amount cannot be changed.",
        400,
      );
    }
    patch.amount = amount;
  }

  if (Object.keys(patch).length === 0) throw new AuthError("Nothing to update.", 400);

  const { error } = await admin.from("employee_advances").update(patch).eq("id", id);
  if (error) throw error;

  return json({ success: true, advance: await oneAdvance(me, id) }, 200);
}

/**
 * Recovery against an advance. Same shape as a loan recovery: a ledger row,
 * and the view does the arithmetic. If the month could not cover the whole
 * advance, the remainder stays outstanding and the recovery month moves on
 * -- that is the carry-forward, and the ledger rows show it month by month.
 */
async function recordAdvanceRecovery(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "loans_advances.edit");
  const admin = me.admin;

  const id = uuidArg(body.advance_id, body.id);
  if (!id) throw new AuthError("Missing advance_id", 400);

  const t = (body.txn ?? body) as Record<string, unknown>;
  const amount = money(t.amount);
  if (amount === null || amount <= 0) throw new AuthError("Amount must be greater than zero.", 400);

  const { data: adv } = await admin
    .from("employee_advances").select("*").eq("id", id).maybeSingle();
  if (!adv) throw new AuthError("Advance not found.", 404);
  if (!OPEN_STATES.includes(adv.status as string)) {
    throw new AuthError("This advance is already fully recovered or cancelled.", 400);
  }
  if (adv.status !== "approved") {
    throw new AuthError("This advance has not been approved yet.", 400);
  }

  const rawType = str(t.txn_type);
  const txnType = rawType === "waiver" || rawType === "adjustment" ? rawType : "recovery";
  const txnMonth = monthStart(t.txn_month, t.payroll_period, t.txn_date)
    ?? String(adv.recovery_month);

  const { data: before, error: balErr } = await admin
    .from("advance_balances").select("outstanding").eq("advance_id", id).maybeSingle();
  if (balErr) throw balErr;
  const outstanding = Number(before?.outstanding ?? adv.amount);
  if (amount > outstanding + 0.005) {
    throw new AuthError(`This exceeds the outstanding amount of ${outstanding.toFixed(2)}.`, 400);
  }

  const { data: txn, error } = await admin.from("employee_advance_transactions").insert({
    advance_id: id,
    txn_month: txnMonth,
    txn_type: txnType,
    amount,
    payroll_entry_id: uuidArg(t.payroll_entry_id),
    remarks: str(t.remarks) || str(t.notes) || null,
    status: "completed",
    created_by: me.partyId,
  }).select().single();
  if (error) throw error;

  const { data: after } = await admin
    .from("advance_balances").select("outstanding").eq("advance_id", id).maybeSingle();
  const remaining = Number(after?.outstanding ?? 0);
  const fullyRecovered = remaining <= 0.005;

  if (fullyRecovered) {
    await admin.from("employee_advances")
      .update({ status: "completed", closed_on: txnMonth }).eq("id", id);
  } else {
    // The shortfall carries. The same advance stays open and simply moves
    // to the month it will be taken from next.
    const carry = monthStart(body.carry_forward_period, t.carry_forward_period)
      ?? addMonths(txnMonth, 1);
    if (carry > String(adv.recovery_month)) {
      await admin.from("employee_advances").update({ recovery_month: carry }).eq("id", id);
    }
  }

  return json({
    success: true,
    transaction: shapeAdvanceTxn(txn),
    outstanding: remaining,
    fully_recovered: fullyRecovered,
    advance: await oneAdvance(me, id),
  }, 200);
}

async function updateAdvanceStatus(me: Caller, body: Record<string, unknown>, forced?: string) {
  requirePermission(me, "loans_advances.approve");
  const admin = me.admin;

  const id = uuidArg(body.advance_id, body.id);
  if (!id) throw new AuthError("Missing advance_id", 400);

  const wanted = forced ?? toStoredStatus(body.new_status ?? body.status);
  if (!wanted || !["approved", "completed", "cancelled"].includes(wanted)) {
    throw new AuthError("That is not a status an advance can be moved to.", 400);
  }

  const { data: adv } = await admin
    .from("employee_advances").select("*").eq("id", id).maybeSingle();
  if (!adv) throw new AuthError("Advance not found.", 404);
  if (adv.status === wanted) {
    return json({ success: true, advance: await oneAdvance(me, id) }, 200);
  }
  if (adv.status === "cancelled") {
    throw new AuthError("This advance was cancelled and cannot be reopened.", 400);
  }

  const patch: Record<string, unknown> = { status: wanted };
  if (wanted === "approved") {
    if (adv.status === "completed") throw new AuthError("This advance is already closed.", 400);
    patch.approved_by = me.partyId;
    patch.approved_on = new Date().toISOString();
    patch.closed_on = null;
  } else {
    patch.closed_on = today();
  }

  const { error } = await admin.from("employee_advances").update(patch).eq("id", id);
  if (error) throw error;

  if (wanted === "approved") {
    const { data: already } = await admin
      .from("employee_advance_transactions").select("id")
      .eq("advance_id", id).eq("txn_type", "disbursement").limit(1);
    if (!already || already.length === 0) {
      await writeDisbursement(
        me, "advance", id, Number(adv.amount), String(adv.advance_date));
    }
  }

  return json({ success: true, advance: await oneAdvance(me, id) }, 200);
}

// ============================================================
//  ESI / PF SETTINGS
// ============================================================

const SETTINGS_COLUMNS =
  "id, esi_wage_ceiling, esi_employee_rate, esi_employer_rate, " +
  "pf_applicable_company_wide, pf_wage_ceiling, pf_employee_rate";

async function getPayrollSettings(me: Caller) {
  requirePermission(me, "admin.settings");
  const { data, error } = await me.admin
    .from("app_settings").select(SETTINGS_COLUMNS).eq("id", 1).single();
  if (error) throw error;
  return json({ success: true, settings: data }, 200);
}

async function updatePayrollSettings(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "admin.settings");

  const s = (body.settings ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  const rate = (key: string, label: string) => {
    if (s[key] === undefined || s[key] === null || s[key] === "") return;
    const v = Number(s[key]);
    if (!isFinite(v) || v < 0 || v > 100) {
      throw new AuthError(`${label} must be between 0 and 100.`, 400);
    }
    patch[key] = Number(v.toFixed(4));
  };
  const ceiling = (key: string, label: string) => {
    if (s[key] === undefined || s[key] === null || s[key] === "") return;
    const v = Number(s[key]);
    if (!isFinite(v) || v < 0) throw new AuthError(`${label} must be a positive number.`, 400);
    patch[key] = Number(v.toFixed(2));
  };

  ceiling("esi_wage_ceiling", "ESI wage ceiling");
  rate("esi_employee_rate", "ESI employee rate");
  rate("esi_employer_rate", "ESI employer rate");
  ceiling("pf_wage_ceiling", "PF wage ceiling");
  rate("pf_employee_rate", "PF employee rate");
  if (s.pf_applicable_company_wide !== undefined) {
    patch.pf_applicable_company_wide = s.pf_applicable_company_wide === true;
  }

  if (Object.keys(patch).length === 0) throw new AuthError("Nothing to update.", 400);

  const { data, error } = await me.admin
    .from("app_settings").update(patch).eq("id", 1).select(SETTINGS_COLUMNS).single();
  if (error) throw error;

  return json({ success: true, settings: data }, 200);
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
    // ---- holidays ----
    case "get_holidays_data":        return await getHolidaysData(me, body);
    case "generate_yearly_holidays": return await generateYearlyHolidays(me, body);
    case "create_holiday":           return await createHoliday(me, body);
    case "update_holiday":           return await updateHoliday(me, body);
    case "toggle_holiday_status":    return await toggleHolidayStatus(me, body);
    case "retire_holiday":           return await toggleHolidayStatus(me, { ...body, is_active: false });
    case "add_holiday_type":         return await addHolidayType(me, body);
    case "toggle_holiday_type":      return await toggleHolidayType(me, body);

    // ---- loans ----
    case "get_loans_data":           return await getLoansData(me, body);
    case "create_loan":              return await createLoan(me, body);
    case "update_loan":              return await updateLoan(me, body);
    case "add_loan_transaction":     return await addLoanTransaction(me, body);
    case "update_loan_status":       return await updateLoanStatus(me, body);
    case "approve_loan":             return await updateLoanStatus(me, body, "approved");
    case "close_loan":               return await updateLoanStatus(me, body, "completed");
    case "cancel_loan":              return await updateLoanStatus(me, body, "cancelled");

    // ---- advances ----
    case "get_advances_data":        return await getAdvancesData(me, body);
    case "create_advance":           return await createAdvance(me, body);
    case "update_advance":           return await updateAdvance(me, body);
    case "record_advance_recovery":  return await recordAdvanceRecovery(me, body);
    case "add_advance_transaction":  return await recordAdvanceRecovery(me, body);
    case "update_advance_status":    return await updateAdvanceStatus(me, body);
    case "approve_advance":          return await updateAdvanceStatus(me, body, "approved");
    case "close_advance":            return await updateAdvanceStatus(me, body, "completed");
    case "cancel_advance":           return await updateAdvanceStatus(me, body, "cancelled");

    // ---- ESI / PF ----
    case "get_payroll_settings":     return await getPayrollSettings(me);
    case "update_payroll_settings":  return await updatePayrollSettings(me, body);

    default:
      throw new AuthError("Unknown action", 400);
  }
}));
