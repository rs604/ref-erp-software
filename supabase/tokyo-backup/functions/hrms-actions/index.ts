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

// Holidays are grouped by CALENDAR year, not financial year — published holiday lists
// and day-to-day lookups both work on calendar years.
function calendarYearOf(dateStr: string): number {
  return new Date(dateStr).getFullYear();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { action, requester_id } = body;
    if (!action || !requester_id) return jsonResponse({ error: "Missing action or requester_id" }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: requester, error: reqErr } = await supabase.from("employees").select("id, role, status").eq("id", requester_id).maybeSingle();
    if (reqErr) throw reqErr;
    if (!requester || requester.status !== "active") return jsonResponse({ error: "Not authorized" }, 403);

    // ==================== HOLIDAYS ====================

    if (action === "get_holidays_data") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "holidays.view"))) return jsonResponse({ error: "You don't have permission to view Holidays" }, 403);
      const [holidaysRes, typesRes, branchesRes] = await Promise.all([
        supabase.from("holidays").select("*, holiday_types(name), branches(name)").order("holiday_date"),
        supabase.from("holiday_types").select("*").eq("is_active", true).order("name"),
        supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      ]);
      if (holidaysRes.error) throw holidaysRes.error;
      if (typesRes.error) throw typesRes.error;
      if (branchesRes.error) throw branchesRes.error;
      return jsonResponse({ success: true, holidays: holidaysRes.data, holidayTypes: typesRes.data, branches: branchesRes.data }, 200);
    }

    // Generate the standard yearly holiday list for a calendar year.
    // Fixed-date holidays get real dates. Lunar-calendar festivals are created with a NULL
    // date for the user to fill in, because no reliable free API exists for Indian festival
    // dates and silently-wrong payroll dates would be worse than a 5-minute manual step.
    if (action === "generate_yearly_holidays") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "holidays.create"))) return jsonResponse({ error: "You don't have permission to create Holidays" }, 403);
      const { calendar_year } = body;
      const year = parseInt(calendar_year, 10);
      if (!year || year < 2000 || year > 2100) return jsonResponse({ error: "Please provide a valid year, e.g. 2026" }, 400);

      // All four fixed-date holidays fall within the same calendar year — much simpler
      // than the financial-year model, where January dates belonged to the next year.
      const FIXED = [
        { key: "guru_gobind_singh_jayanti", name: "Guru Gobind Singh Jayanti", month: 1, day: 5, year },
        { key: "republic_day", name: "Republic Day", month: 1, day: 26, year },
        { key: "independence_day", name: "Independence Day", month: 8, day: 15, year },
        { key: "gandhi_jayanti", name: "Gandhi Jayanti", month: 10, day: 2, year },
      ];
      // Lunar-calendar festivals — date left null, user fills in
      const FESTIVALS = [
        { key: "holi", name: "Holi" },
        { key: "dussehra", name: "Dussehra" },
        { key: "diwali", name: "Diwali" },
        { key: "vishwakarma_day", name: "Vishwakarma Day" },
        { key: "guru_nanak_jayanti", name: "Guru Nanak Dev Jayanti" },
      ];

      const { data: existing } = await supabase.from("holidays").select("template_key").eq("calendar_year", year).not("template_key", "is", null);
      const existingKeys = new Set((existing || []).map((r: any) => r.template_key));

      const toInsert: any[] = [];
      for (const f of FIXED) {
        if (existingKeys.has(f.key)) continue;
        const dateStr = `${f.year}-${String(f.month).padStart(2, "0")}-${String(f.day).padStart(2, "0")}`;
        toInsert.push({
          holiday_date: dateStr, holiday_name: f.name, calendar_year: year, branch_id: null,
          is_full_day: true, is_optional: false, template_key: f.key, created_by: requester_id,
        });
      }
      for (const f of FESTIVALS) {
        if (existingKeys.has(f.key)) continue;
        toInsert.push({
          holiday_date: null, holiday_name: f.name, calendar_year: year, branch_id: null,
          is_full_day: true, is_optional: false, template_key: f.key, created_by: requester_id,
        });
      }

      if (toInsert.length === 0) {
        return jsonResponse({ success: true, created: 0, message: `All standard holidays already exist for ${year}.` }, 200);
      }
      const { error } = await supabase.from("holidays").insert(toInsert);
      if (error) throw error;

      const pendingCount = toInsert.filter((h: any) => !h.holiday_date).length;
      return jsonResponse({
        success: true,
        created: toInsert.length,
        pending_dates: pendingCount,
        message: `Created ${toInsert.length} holidays for ${year}. ${pendingCount} festival date${pendingCount === 1 ? "" : "s"} still need${pendingCount === 1 ? "s" : ""} to be filled in.`,
      }, 200);
    }

    if (action === "create_holiday") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "holidays.create"))) return jsonResponse({ error: "You don't have permission to create Holidays" }, 403);
      const { holiday } = body;
      if (!holiday?.holiday_date) return jsonResponse({ error: "Holiday Date is required" }, 400);
      if (!holiday?.holiday_name?.trim()) return jsonResponse({ error: "Holiday Name is required" }, 400);

      const cy = holiday.calendar_year || calendarYearOf(holiday.holiday_date);

      // Block an exact duplicate: same date, same branch scope, still active
      let dupeQuery = supabase.from("holidays").select("id, holiday_name").eq("holiday_date", holiday.holiday_date).eq("is_active", true);
      dupeQuery = holiday.branch_id ? dupeQuery.eq("branch_id", holiday.branch_id) : dupeQuery.is("branch_id", null);
      const { data: dupe } = await dupeQuery.maybeSingle();
      if (dupe) return jsonResponse({ error: `A holiday already exists on this date for this branch: "${dupe.holiday_name}".` }, 409);

      const { data, error } = await supabase.from("holidays").insert({
        holiday_date: holiday.holiday_date,
        holiday_name: holiday.holiday_name.trim(),
        holiday_type_id: holiday.holiday_type_id || null,
        calendar_year: cy,
        branch_id: holiday.branch_id || null,
        is_full_day: holiday.is_full_day !== false,
        is_optional: !!holiday.is_optional,
        created_by: requester_id,
      }).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, holiday: data }, 200);
    }

    if (action === "update_holiday") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "holidays.edit"))) return jsonResponse({ error: "You don't have permission to edit Holidays" }, 403);
      const { holiday_id, holiday } = body;
      if (!holiday_id) return jsonResponse({ error: "Missing holiday_id" }, 400);
      if (!holiday?.holiday_name?.trim()) return jsonResponse({ error: "Holiday Name is required" }, 400);

      const updatePayload: any = {
        holiday_name: holiday.holiday_name.trim(),
        holiday_type_id: holiday.holiday_type_id || null,
        branch_id: holiday.branch_id || null,
        is_full_day: holiday.is_full_day !== false,
        is_optional: !!holiday.is_optional,
      };
      if (holiday.holiday_date) {
        updatePayload.holiday_date = holiday.holiday_date;
        updatePayload.calendar_year = holiday.calendar_year || calendarYearOf(holiday.holiday_date);
      }
      const { data, error } = await supabase.from("holidays").update(updatePayload).eq("id", holiday_id).select().single();
      if (error) throw error;

      // Vishwakarma Day is always the day after Diwali (company rule), so setting Diwali's
      // date auto-fills it — but only if it hasn't already been given a date manually.
      let auto_filled = null;
      if (data?.template_key === "diwali" && updatePayload.holiday_date) {
        const { data: vish } = await supabase.from("holidays")
          .select("id, holiday_date")
          .eq("calendar_year", data.calendar_year)
          .eq("template_key", "vishwakarma_day")
          .maybeSingle();
        if (vish && !vish.holiday_date) {
          const d = new Date(updatePayload.holiday_date);
          d.setDate(d.getDate() + 1);
          const nextDay = d.toISOString().split("T")[0];
          await supabase.from("holidays").update({ holiday_date: nextDay, calendar_year: new Date(nextDay).getFullYear() }).eq("id", vish.id);
          auto_filled = { name: "Vishwakarma Day", date: nextDay };
        }
      }

      return jsonResponse({ success: true, holiday: data, auto_filled }, 200);
    }

    if (action === "toggle_holiday_status") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "holidays.delete"))) return jsonResponse({ error: "You don't have permission to deactivate Holidays" }, 403);
      const { holiday_id, is_active } = body;
      if (!holiday_id) return jsonResponse({ error: "Missing holiday_id" }, 400);
      const { data, error } = await supabase.from("holidays").update({ is_active: !!is_active }).eq("id", holiday_id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, holiday: data }, 200);
    }

    if (action === "add_holiday_type") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "holidays.create"))) return jsonResponse({ error: "Not authorized" }, 403);
      const { name } = body;
      if (!name?.trim()) return jsonResponse({ error: "Name is required" }, 400);
      const { data, error } = await supabase.from("holiday_types").insert({ name: name.trim() }).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, item: data }, 200);
    }

    if (action === "toggle_holiday_type") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "holidays.edit"))) return jsonResponse({ error: "Not authorized" }, 403);
      const { id, is_active } = body;
      if (!id) return jsonResponse({ error: "Missing id" }, 400);
      const { data, error } = await supabase.from("holiday_types").update({ is_active: !!is_active }).eq("id", id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, item: data }, 200);
    }

    // ==================== LOANS ====================
    // A LOAN is money lent to an employee, repaid over multiple months by design.
    // Distinct from an ADVANCE (see below), which is early salary for a single month.

    if (action === "get_loans_data") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "loans_advances.view"))) return jsonResponse({ error: "You don't have permission to view Loans" }, 403);
      const { employee_id } = body;

      // employee_loans has TWO foreign keys to employees (employee_id and created_by), so the
      // relationship must be named explicitly or PostgREST refuses the embed (PGRST201).
      let loansQuery = supabase.from("employee_loans").select("*, employees!employee_loans_employee_id_fkey(id, name, employee_code)").eq("ledger_type", "loan").order("created_at", { ascending: false });
      if (employee_id) loansQuery = loansQuery.eq("employee_id", employee_id);
      const { data: loans, error: loansErr } = await loansQuery;
      if (loansErr) throw loansErr;

      const loanIds = (loans || []).map((l: any) => l.id);
      const { data: txns } = loanIds.length > 0
        ? await supabase.from("employee_loan_transactions").select("*").in("loan_id", loanIds).order("txn_date")
        : { data: [] };

      // Balance is DERIVED from transactions, never stored — so it can always be re-verified
      const enriched = (loans || []).map((l: any) => {
        const myTxns = (txns || []).filter((t: any) => t.loan_id === l.id);
        const totalRepaid = myTxns.reduce((sum: number, t: any) => sum + Number(t.amount), 0);
        const balance = Number(l.principal_amount) - totalRepaid;
        return { ...l, transactions: myTxns, total_repaid: totalRepaid, balance };
      });

      return jsonResponse({ success: true, loans: enriched }, 200);
    }

    if (action === "create_loan") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "loans_advances.create"))) return jsonResponse({ error: "You don't have permission to create Loans" }, 403);
      const { loan } = body;
      if (!loan?.employee_id) return jsonResponse({ error: "Employee is required" }, 400);
      const principal = Number(loan.principal_amount);
      if (!principal || principal <= 0) return jsonResponse({ error: "Amount must be greater than zero" }, 400);
      if (!loan?.disbursed_on) return jsonResponse({ error: "Disbursed On date is required" }, 400);
      if (!loan.monthly_deduction && !loan.total_installments) {
        return jsonResponse({ error: "Provide either a Monthly Deduction amount or a number of Installments" }, 400);
      }
      if (loan.monthly_deduction && Number(loan.monthly_deduction) > principal) {
        return jsonResponse({ error: "Monthly deduction cannot exceed the total amount" }, 400);
      }

      const { data, error } = await supabase.from("employee_loans").insert({
        employee_id: loan.employee_id,
        ledger_type: "loan",
        principal_amount: principal,
        disbursed_on: loan.disbursed_on,
        monthly_deduction: loan.monthly_deduction ? Number(loan.monthly_deduction) : null,
        total_installments: loan.total_installments ? Number(loan.total_installments) : null,
        reason: loan.reason || null,
        created_by: requester_id,
      }).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, loan: data }, 200);
    }

    if (action === "add_loan_transaction") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "loans_advances.edit"))) return jsonResponse({ error: "You don't have permission to record repayments" }, 403);
      const { loan_id, txn } = body;
      if (!loan_id) return jsonResponse({ error: "Missing loan_id" }, 400);
      const amount = Number(txn?.amount);
      if (!amount || amount <= 0) return jsonResponse({ error: "Amount must be greater than zero" }, 400);
      if (!txn?.txn_date) return jsonResponse({ error: "Date is required" }, 400);

      const { data: loanRow } = await supabase.from("employee_loans").select("principal_amount, status").eq("id", loan_id).single();
      if (!loanRow) return jsonResponse({ error: "Loan not found" }, 400);
      if (loanRow.status !== "active") return jsonResponse({ error: "This ledger is already closed or cancelled" }, 400);

      const { data: existingTxns } = await supabase.from("employee_loan_transactions").select("amount").eq("loan_id", loan_id);
      const alreadyRepaid = (existingTxns || []).reduce((s: number, t: any) => s + Number(t.amount), 0);
      const remaining = Number(loanRow.principal_amount) - alreadyRepaid;
      if (amount > remaining) {
        return jsonResponse({ error: `This exceeds the outstanding balance of ${remaining.toFixed(2)}.` }, 400);
      }

      const { data, error } = await supabase.from("employee_loan_transactions").insert({
        loan_id,
        txn_date: txn.txn_date,
        amount,
        txn_type: ["deduction", "adjustment", "waiver"].includes(txn.txn_type) ? txn.txn_type : "deduction",
        payroll_period: txn.payroll_period || null,
        notes: txn.notes || null,
        created_by: requester_id,
      }).select().single();
      if (error) throw error;

      if (amount === remaining) {
        await supabase.from("employee_loans").update({ status: "closed", closed_on: txn.txn_date, updated_at: new Date().toISOString() }).eq("id", loan_id);
      }

      return jsonResponse({ success: true, transaction: data, fully_repaid: amount === remaining }, 200);
    }

    if (action === "update_loan_status") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "loans_advances.approve"))) return jsonResponse({ error: "You don't have permission to close or cancel a ledger" }, 403);
      const { loan_id, new_status } = body;
      if (!loan_id || !["active", "closed", "cancelled"].includes(new_status)) return jsonResponse({ error: "Invalid request" }, 400);
      const { data, error } = await supabase.from("employee_loans").update({
        status: new_status,
        closed_on: new_status === "active" ? null : new Date().toISOString().split("T")[0],
        updated_at: new Date().toISOString(),
      }).eq("id", loan_id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, loan: data }, 200);
    }

    // ==================== ADVANCES ====================
    // An ADVANCE is salary paid early (typically the 25th) and recovered from THAT month's
    // salary. It is not an installment plan. It only carries a balance when that month's
    // salary could not cover it in full — the shortfall then carries into the next month.
    // No approval required: an advance is recorded, not requested.

    if (action === "get_advances_data") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "loans_advances.view"))) return jsonResponse({ error: "You don't have permission to view Advances" }, 403);
      const { employee_id } = body;
      let q = supabase.from("employee_advances").select("*, employees!employee_advances_employee_id_fkey(id, name, employee_code)").order("advance_date", { ascending: false });
      if (employee_id) q = q.eq("employee_id", employee_id);
      const { data, error } = await q;
      if (error) throw error;
      const enriched = (data || []).map((a: any) => ({
        ...a,
        outstanding: Number(a.amount) - Number(a.recovered_amount || 0),
      }));
      return jsonResponse({ success: true, advances: enriched }, 200);
    }

    if (action === "create_advance") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "loans_advances.create"))) return jsonResponse({ error: "You don't have permission to record Advances" }, 403);
      const { advance } = body;
      if (!advance?.employee_id) return jsonResponse({ error: "Employee is required" }, 400);
      const amount = Number(advance.amount);
      if (!amount || amount <= 0) return jsonResponse({ error: "Amount must be greater than zero" }, 400);
      if (!advance?.advance_date) return jsonResponse({ error: "Advance Date is required" }, 400);
      if (!/^\d{4}-\d{2}$/.test(advance?.payroll_period || "")) return jsonResponse({ error: "Payroll month is required" }, 400);

      const { data, error } = await supabase.from("employee_advances").insert({
        employee_id: advance.employee_id,
        amount,
        advance_date: advance.advance_date,
        payroll_period: advance.payroll_period,
        notes: advance.notes || null,
        created_by: requester_id,
      }).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, advance: data }, 200);
    }

    if (action === "record_advance_recovery") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "loans_advances.edit"))) return jsonResponse({ error: "You don't have permission to record recovery" }, 403);
      const { advance_id, amount: rawAmount, carry_forward_period } = body;
      if (!advance_id) return jsonResponse({ error: "Missing advance_id" }, 400);
      const amount = Number(rawAmount);
      if (!amount || amount <= 0) return jsonResponse({ error: "Amount must be greater than zero" }, 400);

      const { data: adv } = await supabase.from("employee_advances").select("*").eq("id", advance_id).single();
      if (!adv) return jsonResponse({ error: "Advance not found" }, 400);
      if (adv.status !== "outstanding") return jsonResponse({ error: "This advance is already fully recovered" }, 400);

      const outstanding = Number(adv.amount) - Number(adv.recovered_amount || 0);
      if (amount > outstanding) {
        return jsonResponse({ error: `This exceeds the outstanding amount of ${outstanding.toFixed(2)}.` }, 400);
      }

      const newRecovered = Number(adv.recovered_amount || 0) + amount;
      const fullyRecovered = newRecovered >= Number(adv.amount);

      const updatePayload: any = {
        recovered_amount: newRecovered,
        status: fullyRecovered ? "recovered" : "outstanding",
        updated_at: new Date().toISOString(),
      };
      // A shortfall carries into a later payroll month — the same advance record stays
      // open and simply moves to the next period, rather than spawning a new record.
      if (!fullyRecovered && carry_forward_period && /^\d{4}-\d{2}$/.test(carry_forward_period)) {
        updatePayload.payroll_period = carry_forward_period;
        updatePayload.carried_forward = true;
      }

      const { data, error } = await supabase.from("employee_advances").update(updatePayload).eq("id", advance_id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, advance: data, fully_recovered: fullyRecovered }, 200);
    }

    if (action === "cancel_advance") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "loans_advances.approve"))) return jsonResponse({ error: "You don't have permission to cancel an advance" }, 403);
      const { advance_id } = body;
      if (!advance_id) return jsonResponse({ error: "Missing advance_id" }, 400);
      const { data, error } = await supabase.from("employee_advances").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", advance_id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, advance: data }, 200);
    }

    // ==================== PAYROLL SETTINGS ====================

    if (action === "get_payroll_settings") {
      if (requester.role !== "owner") return jsonResponse({ error: "Only the Owner can view payroll settings" }, 403);
      const { data, error } = await supabase.from("app_settings").select("esi_wage_ceiling, esi_employee_rate, pf_applicable_company_wide, pf_wage_ceiling, pf_employee_rate").limit(1).maybeSingle();
      if (error) throw error;
      return jsonResponse({ success: true, settings: data }, 200);
    }

    if (action === "update_payroll_settings") {
      if (requester.role !== "owner") return jsonResponse({ error: "Only the Owner can change payroll settings" }, 403);
      const { settings } = body;
      const payload: any = {};
      if (settings?.esi_wage_ceiling !== undefined) {
        const v = Number(settings.esi_wage_ceiling);
        if (isNaN(v) || v < 0) return jsonResponse({ error: "ESI wage ceiling must be a positive number" }, 400);
        payload.esi_wage_ceiling = v;
      }
      if (settings?.esi_employee_rate !== undefined) {
        const v = Number(settings.esi_employee_rate);
        if (isNaN(v) || v < 0 || v > 100) return jsonResponse({ error: "ESI rate must be between 0 and 100" }, 400);
        payload.esi_employee_rate = v;
      }
      if (Object.keys(payload).length === 0) return jsonResponse({ error: "Nothing to update" }, 400);

      const { data: existing } = await supabase.from("app_settings").select("id").limit(1).maybeSingle();
      if (!existing) return jsonResponse({ error: "Settings row not found" }, 400);
      const { data, error } = await supabase.from("app_settings").update(payload).eq("id", existing.id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, settings: data }, 200);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
