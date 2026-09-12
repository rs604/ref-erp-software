import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function hasPermission(supabase: any, employeeId: string, role: string, key: string): Promise<boolean> {
  if (role === "owner") return true;
  const { data: perm } = await supabase.from("permissions").select("id").eq("key", key).maybeSingle();
  if (!perm) return false;
  const { data: grant } = await supabase.from("employee_permissions").select("id").eq("employee_id", employeeId).eq("permission_id", perm.id).maybeSingle();
  return !!grant;
}

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Mirrors the formulas already proven in the company's existing salary spreadsheet.
// Calculated server-side only: the browser never decides what anyone is paid.
function computeEntry(input: any, esiApplicable: boolean, esiCeiling: number, esiRate: number) {
  const basic = Number(input.basic_wages) || 0;
  const daysInMonth = Number(input.days_in_month) || 30;
  const workingDays = Number(input.working_days) || 0;
  const otHours = Number(input.ot_hours) || 0;
  const incentives = Number(input.incentives) || 0;

  const perDay = daysInMonth > 0 ? basic / daysInMonth : 0;
  const otDays = otHours / 8;                       // 8 hours = 1 OT day
  const salary = round2(perDay * workingDays);      // prorated by days actually worked
  const otCharges = round2(perDay * otDays);        // OT paid at the same per-day rate
  const totalEarnings = round2(salary + otCharges + incentives);

  // ESI eligibility is judged on the FULL monthly wage (statutory ceiling), but the
  // amount is charged on what was actually earned this month.
  let esi = 0;
  if (esiApplicable && basic <= esiCeiling) {
    esi = round2(salary * (esiRate / 100));
  }

  const loan = Number(input.loan_deduction) || 0;
  const advance = Number(input.advance_deduction) || 0;
  const other = Number(input.other_deduction) || 0;
  const totalDeductions = round2(loan + advance + other + esi);

  return {
    working_days: workingDays,
    absent_days: round2(daysInMonth - workingDays),   // always derived, never typed
    ot_days: round2(otDays),
    salary_amount: salary,
    ot_charges: otCharges,
    total_earnings: totalEarnings,
    esi_amount: esi,
    total_deductions: totalDeductions,
    net_payable: round2(totalEarnings - totalDeductions),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { action, requester_id } = body;
    if (!action || !requester_id) return jsonResponse({ error: "Missing action or requester_id" }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: requester } = await supabase.from("employees").select("id, role, status").eq("id", requester_id).maybeSingle();
    if (!requester || requester.status !== "active") return jsonResponse({ error: "Not authorized" }, 403);

    // ---------------- LIST PERIODS ----------------
    if (action === "get_payroll_periods") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "payroll.view"))) return jsonResponse({ error: "You don't have permission to view payroll" }, 403);
      const { data, error } = await supabase.from("payroll_periods").select("*").order("period_year", { ascending: false }).order("period_month", { ascending: false });
      if (error) throw error;
      return jsonResponse({ success: true, periods: data }, 200);
    }

    // ---------------- CREATE A MONTH ----------------
    if (action === "create_payroll_period") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "payroll.create"))) return jsonResponse({ error: "You don't have permission to create a salary sheet" }, 403);
      const month = parseInt(body.period_month, 10);
      const year = parseInt(body.period_year, 10);
      if (!month || month < 1 || month > 12) return jsonResponse({ error: "Please choose a valid month" }, 400);
      if (!year || year < 2000 || year > 2100) return jsonResponse({ error: "Please choose a valid year" }, 400);

      const { data: existing } = await supabase.from("payroll_periods").select("id, status").eq("period_month", month).eq("period_year", year).maybeSingle();
      if (existing) return jsonResponse({ error: "A salary sheet already exists for this month." }, 409);

      // Snapshot the ESI settings so this month's figures can never shift later
      const { data: settings } = await supabase.from("app_settings").select("esi_wage_ceiling, esi_employee_rate").limit(1).maybeSingle();
      const esiCeiling = Number(settings?.esi_wage_ceiling ?? 21000);
      const esiRate = Number(settings?.esi_employee_rate ?? 0.75);

      const { data: period, error: perErr } = await supabase.from("payroll_periods").insert({
        period_month: month, period_year: year,
        esi_wage_ceiling: esiCeiling, esi_employee_rate: esiRate,
        created_by: requester_id,
      }).select().single();
      if (perErr) throw perErr;

      // Pull every active employee, plus their outstanding ledger balances
      const [empRes, loanRes, advRes] = await Promise.all([
        supabase.from("employees").select("id, salary_basic, salary_hra, salary_da, salary_ta").eq("status", "active"),
        supabase.from("employee_loans").select("id, employee_id, principal_amount, monthly_deduction, total_installments").eq("status", "active"),
        supabase.from("employee_advances").select("id, employee_id, amount, recovered_amount").eq("status", "outstanding"),
      ]);
      const employees = empRes.data || [];

      // Loan balances are derived from transaction history, never stored
      const loanIds = (loanRes.data || []).map((l: any) => l.id);
      const { data: loanTxns } = loanIds.length > 0
        ? await supabase.from("employee_loan_transactions").select("loan_id, amount").in("loan_id", loanIds)
        : { data: [] };

      const daysInMonth = new Date(year, month, 0).getDate();

      const rows = employees.map((e: any) => {
        const basic = (Number(e.salary_basic) || 0) + (Number(e.salary_hra) || 0) + (Number(e.salary_da) || 0) + (Number(e.salary_ta) || 0);

        // Suggest this month's loan instalment, capped at what's actually left owing
        const loan = (loanRes.data || []).find((l: any) => l.employee_id === e.id);
        let loanDeduction = 0;
        let loanId = null;
        if (loan) {
          const repaid = (loanTxns || []).filter((t: any) => t.loan_id === loan.id).reduce((s: number, t: any) => s + Number(t.amount), 0);
          const balance = Number(loan.principal_amount) - repaid;
          const instalment = loan.monthly_deduction
            ? Number(loan.monthly_deduction)
            : (loan.total_installments ? Number(loan.principal_amount) / Number(loan.total_installments) : 0);
          loanDeduction = round2(Math.min(instalment, balance));
          loanId = loan.id;
        }

        // Advances are recovered in full by default, being early salary for this month
        const adv = (advRes.data || []).find((a: any) => a.employee_id === e.id);
        const advanceDeduction = adv ? round2(Number(adv.amount) - Number(adv.recovered_amount || 0)) : 0;

        return {
          period_id: period.id, employee_id: e.id,
          basic_wages: basic, days_in_month: daysInMonth,
          working_days: 0, absent_days: daysInMonth, ot_hours: 0, incentives: 0,
          loan_deduction: loanDeduction, advance_deduction: advanceDeduction, other_deduction: 0,
          loan_id: loanId, advance_id: adv?.id || null,
        };
      });

      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("payroll_entries").insert(rows);
        if (insErr) throw insErr;
      }

      return jsonResponse({ success: true, period, employee_count: rows.length }, 200);
    }

    // ---------------- LOAD A SHEET ----------------
    if (action === "get_payroll_sheet") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "payroll.view"))) return jsonResponse({ error: "You don't have permission to view payroll" }, 403);
      const { period_id } = body;
      if (!period_id) return jsonResponse({ error: "Missing period_id" }, 400);

      const { data: period } = await supabase.from("payroll_periods").select("*").eq("id", period_id).maybeSingle();
      if (!period) return jsonResponse({ error: "Salary sheet not found" }, 404);

      const { data: entries, error } = await supabase
        .from("payroll_entries")
        .select("*, employees!payroll_entries_employee_id_fkey(id, name, employee_code, esi_applicable, last_increment_date, departments(name), designations(name))")
        .eq("period_id", period_id);
      if (error) throw error;

      // Days at the current salary are counted as PRESENT DAYS actually recorded, not
      // calendar days - the company grants an increment after roughly 340 days present.
      // This sums working_days from every earlier salary sheet dated on or after the
      // employee's increment date; the current month's present days are added live in the UI.
      const empIds = (entries || []).map((e: any) => e.employee_id);
      const priorPresent: Record<string, number> = {};
      if (empIds.length > 0) {
        const [allPeriodsRes, priorEntriesRes] = await Promise.all([
          supabase.from("payroll_periods").select("id, period_month, period_year"),
          supabase.from("payroll_entries").select("employee_id, period_id, working_days").in("employee_id", empIds).neq("period_id", period_id),
        ]);
        const periodById: Record<string, any> = {};
        (allPeriodsRes.data || []).forEach((p: any) => { periodById[p.id] = p; });

        const incByEmp: Record<string, string | null> = {};
        (entries || []).forEach((e: any) => { incByEmp[e.employee_id] = e.employees?.last_increment_date || null; });

        (priorEntriesRes.data || []).forEach((row: any) => {
          const inc = incByEmp[row.employee_id];
          if (!inc) return;
          const p = periodById[row.period_id];
          if (!p) return;
          // A salary month counts if the month itself starts on or after the increment date
          const monthStart = new Date(p.period_year, p.period_month - 1, 1);
          const incDate = new Date(inc);
          const incMonthStart = new Date(incDate.getFullYear(), incDate.getMonth(), 1);
          if (monthStart >= incMonthStart) {
            priorPresent[row.employee_id] = (priorPresent[row.employee_id] || 0) + Number(row.working_days || 0);
          }
        });
      }

      const enriched = (entries || []).map((e: any) => ({
        ...e,
        prior_present_days: round2(priorPresent[e.employee_id] || 0),
      }));

      const sorted = enriched.sort((a: any, b: any) =>
        (a.employees?.employee_code || "").localeCompare(b.employees?.employee_code || ""));

      return jsonResponse({ success: true, period, entries: sorted }, 200);
    }

    // ---------------- SAVE GRID EDITS ----------------
    if (action === "save_payroll_entries") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "payroll.edit"))) return jsonResponse({ error: "You don't have permission to edit payroll" }, 403);
      const { period_id, entries } = body;
      if (!period_id || !Array.isArray(entries)) return jsonResponse({ error: "Invalid request" }, 400);

      const { data: period } = await supabase.from("payroll_periods").select("*").eq("id", period_id).maybeSingle();
      if (!period) return jsonResponse({ error: "Salary sheet not found" }, 404);
      if (period.status === "finalised") return jsonResponse({ error: "This salary sheet is finalised and can no longer be edited." }, 400);

      const employeeIds = entries.map((e: any) => e.employee_id);
      const { data: emps } = await supabase.from("employees").select("id, esi_applicable, name").in("id", employeeIds);
      const esiMap: Record<string, boolean> = {};
      const nameMap: Record<string, string> = {};
      (emps || []).forEach((e: any) => { esiMap[e.id] = !!e.esi_applicable; nameMap[e.id] = e.name; });

      // Re-read the protected fields from the database so a tampered request cannot
      // change someone's basic wage or invent extra days in the month.
      const { data: storedRows } = await supabase.from("payroll_entries").select("id, basic_wages, days_in_month").eq("period_id", period_id);
      const storedMap: Record<string, any> = {};
      (storedRows || []).forEach((r: any) => { storedMap[r.id] = r; });
      entries.forEach((e: any) => {
        const stored = storedMap[e.id];
        if (stored) { e.basic_wages = stored.basic_wages; e.days_in_month = stored.days_in_month; }
      });

      const esiCeiling = Number(period.esi_wage_ceiling ?? 21000);
      const esiRate = Number(period.esi_employee_rate ?? 0.75);

      for (const entry of entries) {
        const who = nameMap[entry.employee_id] || "an employee";
        if (Number(entry.working_days) < 0 || Number(entry.ot_hours) < 0) {
          return jsonResponse({ error: `Negative values are not allowed (${who}).` }, 400);
        }
        // Rejected outright rather than silently clamped: a wrong day count should be
        // corrected by a person, not quietly rounded down by the system.
        if (Number(entry.working_days) > Number(entry.days_in_month)) {
          return jsonResponse({ error: `Working days (${entry.working_days}) cannot exceed the ${entry.days_in_month} days in this month \u2014 please check ${who}.` }, 400);
        }
        const computed = computeEntry(entry, esiMap[entry.employee_id], esiCeiling, esiRate);
        // Basic wages and days-in-month are NOT taken from the request: basic comes from
        // Employee Master and the day count from the calendar, so neither is editable here.
        const { error: updErr } = await supabase.from("payroll_entries").update({
          ot_hours: Number(entry.ot_hours) || 0,
          incentives: Number(entry.incentives) || 0,
          incentive_remarks: entry.incentive_remarks || null,
          loan_deduction: Number(entry.loan_deduction) || 0,
          advance_deduction: Number(entry.advance_deduction) || 0,
          remarks: entry.remarks || null,
          ...computed,
          updated_at: new Date().toISOString(),
        }).eq("id", entry.id).eq("period_id", period_id);
        if (updErr) throw updErr;
      }

      return jsonResponse({ success: true, saved: entries.length }, 200);
    }

    // ---------------- FINALISE ----------------
    // This is the only step that touches the loan/advance ledgers. Whatever deduction
    // amount is sitting in the grid is exactly what comes off the ledger - so reducing
    // someone's instalment for the month simply means typing a smaller number.
    if (action === "finalise_payroll") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "payroll.finalise"))) return jsonResponse({ error: "You don't have permission to finalise payroll" }, 403);
      const { period_id } = body;
      if (!period_id) return jsonResponse({ error: "Missing period_id" }, 400);

      const { data: period } = await supabase.from("payroll_periods").select("*").eq("id", period_id).maybeSingle();
      if (!period) return jsonResponse({ error: "Salary sheet not found" }, 404);
      // Guard against double-deduction if finalise is somehow triggered twice
      if (period.status === "finalised") return jsonResponse({ error: "This salary sheet has already been finalised." }, 400);

      const { data: entries } = await supabase.from("payroll_entries").select("*").eq("period_id", period_id);
      const periodLabel = `${period.period_year}-${String(period.period_month).padStart(2, "0")}`;
      const today = new Date().toISOString().split("T")[0];

      let loansTouched = 0;
      let advancesTouched = 0;

      for (const entry of entries || []) {
        // --- Loan deduction ---
        const loanAmt = Number(entry.loan_deduction) || 0;
        if (loanAmt > 0 && entry.loan_id) {
          const { data: loan } = await supabase.from("employee_loans").select("principal_amount, status").eq("id", entry.loan_id).maybeSingle();
          if (loan && loan.status === "active") {
            const { data: txns } = await supabase.from("employee_loan_transactions").select("amount").eq("loan_id", entry.loan_id);
            const repaid = (txns || []).reduce((s: number, t: any) => s + Number(t.amount), 0);
            const remaining = Number(loan.principal_amount) - repaid;
            const applied = Math.min(loanAmt, remaining);
            if (applied > 0) {
              await supabase.from("employee_loan_transactions").insert({
                loan_id: entry.loan_id, txn_date: today, amount: applied,
                txn_type: "deduction", payroll_period: periodLabel,
                payroll_period_id: period_id,
                notes: `Salary deduction for ${periodLabel}`,
                created_by: requester_id,
              });
              if (applied >= remaining) {
                await supabase.from("employee_loans").update({ status: "closed", closed_on: today, updated_at: new Date().toISOString() }).eq("id", entry.loan_id);
              }
              loansTouched++;
            }
          }
        }

        // --- Advance recovery ---
        const advAmt = Number(entry.advance_deduction) || 0;
        if (advAmt > 0 && entry.advance_id) {
          const { data: adv } = await supabase.from("employee_advances").select("amount, recovered_amount, status").eq("id", entry.advance_id).maybeSingle();
          if (adv && adv.status === "outstanding") {
            const outstanding = Number(adv.amount) - Number(adv.recovered_amount || 0);
            const applied = Math.min(advAmt, outstanding);
            if (applied > 0) {
              const newRecovered = Number(adv.recovered_amount || 0) + applied;
              const fully = newRecovered >= Number(adv.amount);
              const updatePayload: any = {
                recovered_amount: newRecovered,
                status: fully ? "recovered" : "outstanding",
                recovered_in_period_id: period_id,
                updated_at: new Date().toISOString(),
              };
              // A shortfall rolls into the next salary month, same record
              if (!fully) {
                const nm = period.period_month === 12 ? 1 : period.period_month + 1;
                const ny = period.period_month === 12 ? period.period_year + 1 : period.period_year;
                updatePayload.payroll_period = `${ny}-${String(nm).padStart(2, "0")}`;
                updatePayload.carried_forward = true;
              }
              await supabase.from("employee_advances").update(updatePayload).eq("id", entry.advance_id);
              advancesTouched++;
            }
          }
        }
      }

      const { error: finErr } = await supabase.from("payroll_periods").update({
        status: "finalised", finalised_by: requester_id, finalised_at: new Date().toISOString(),
      }).eq("id", period_id).eq("status", "draft");
      if (finErr) throw finErr;

      return jsonResponse({
        success: true,
        message: `Salary sheet finalised. ${loansTouched} loan deduction${loansTouched === 1 ? "" : "s"} and ${advancesTouched} advance recover${advancesTouched === 1 ? "y" : "ies"} posted to the ledgers.`,
      }, 200);
    }

    // ---------------- SALARY SLIP ----------------
    if (action === "get_salary_slip") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "payroll.view"))) return jsonResponse({ error: "You don't have permission to view payroll" }, 403);
      const { entry_id } = body;
      if (!entry_id) return jsonResponse({ error: "Missing entry_id" }, 400);

      const { data: entry, error } = await supabase
        .from("payroll_entries")
        .select("*, employees!payroll_entries_employee_id_fkey(id, name, employee_code, mobile_number, date_of_joining, bank_name, bank_account_number, pf_number, esi_number, departments(name), designations(name), branches(name)), payroll_periods(period_month, period_year, status)")
        .eq("id", entry_id).maybeSingle();
      if (error) throw error;
      if (!entry) return jsonResponse({ error: "Entry not found" }, 404);

      return jsonResponse({ success: true, slip: entry }, 200);
    }

    // ---------------- COLUMN WIDTHS ----------------
    // Saved company-wide so the layout carries over to every future month's sheet.
    if (action === "get_column_widths") {
      const { data } = await supabase.from("app_settings").select("payroll_column_widths").limit(1).maybeSingle();
      return jsonResponse({ success: true, widths: data?.payroll_column_widths || null }, 200);
    }

    if (action === "save_column_widths") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "payroll.view"))) return jsonResponse({ error: "Not authorized" }, 403);
      const { widths } = body;
      if (!widths || typeof widths !== "object") return jsonResponse({ error: "Invalid widths" }, 400);
      const { data: existing } = await supabase.from("app_settings").select("id").limit(1).maybeSingle();
      if (!existing) return jsonResponse({ error: "Settings row not found" }, 400);
      const { error } = await supabase.from("app_settings").update({ payroll_column_widths: widths }).eq("id", existing.id);
      if (error) throw error;
      return jsonResponse({ success: true }, 200);
    }

    // ---------------- DELETE A DRAFT ----------------
    if (action === "delete_payroll_period") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "payroll.finalise"))) return jsonResponse({ error: "You don't have permission to delete a salary sheet" }, 403);
      const { period_id } = body;
      const { data: period } = await supabase.from("payroll_periods").select("status").eq("id", period_id).maybeSingle();
      if (!period) return jsonResponse({ error: "Salary sheet not found" }, 404);
      if (period.status === "finalised") return jsonResponse({ error: "A finalised salary sheet cannot be deleted." }, 400);
      const { error } = await supabase.from("payroll_periods").delete().eq("id", period_id);
      if (error) throw error;
      return jsonResponse({ success: true }, 200);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
