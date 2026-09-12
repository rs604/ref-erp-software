import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { action, requester_id } = body;

    if (!action || !requester_id) {
      return jsonResponse({ error: "Missing action or requester_id" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: requester, error: reqErr } = await supabase
      .from("employees")
      .select("id, role, status")
      .eq("id", requester_id)
      .maybeSingle();

    if (reqErr) throw reqErr;
    if (!requester || requester.status !== "active") {
      return jsonResponse({ error: "Not authorized" }, 403);
    }
    if (!["admin", "owner"].includes(requester.role)) {
      return jsonResponse({ error: "Only admin or owner can perform this action" }, 403);
    }

    if (action === "get_dashboard") {
      const { data: entries, error: entriesErr } = await supabase
        .from("daily_entries")
        .select("*, employees!daily_entries_employee_id_fkey(name, mobile_number), vehicles(vehicle_name)")
        .order("entry_date", { ascending: false })
        .limit(100);
      if (entriesErr) throw entriesErr;

      for (const e of entries) {
        if (e.morning_photo_url) {
          const { data: signed } = await supabase.storage
            .from("vehicle-km-photos")
            .createSignedUrl(e.morning_photo_url, 3600);
          e.morning_photo_signed_url = signed?.signedUrl || null;
        }
        if (e.evening_photo_url) {
          const { data: signed2 } = await supabase.storage
            .from("vehicle-km-photos")
            .createSignedUrl(e.evening_photo_url, 3600);
          e.evening_photo_signed_url = signed2?.signedUrl || null;
        }
      }

      const { data: employees, error: empErr } = await supabase
        .from("employees")
        .select("id, name, mobile_number, role, status, rate_per_km, email, assigned_vehicle_id")
        .order("created_at", { ascending: false });
      if (empErr) throw empErr;

      const { data: vehicles, error: vehErr } = await supabase
        .from("vehicles")
        .select("*")
        .order("created_at", { ascending: false });
      if (vehErr) throw vehErr;

      const { data: settings, error: setErr } = await supabase
        .from("app_settings")
        .select("*")
        .eq("id", 1)
        .single();
      if (setErr) throw setErr;

      const { data: paymentBatches, error: pbErr } = await supabase
        .from("payment_batches")
        .select("*, employees!payment_batches_employee_id_fkey(name)")
        .order("created_at", { ascending: false });
      if (pbErr) throw pbErr;

      return jsonResponse({ success: true, entries, employees, vehicles, settings, paymentBatches }, 200);
    }

    if (action === "assign_vehicle") {
      const { employee_id, vehicle_id } = body;
      if (!employee_id || !vehicle_id) {
        return jsonResponse({ error: "Missing employee_id or vehicle_id" }, 400);
      }

      const { data: vehicle, error: vehCheckErr } = await supabase
        .from("vehicles")
        .select("id, ownership_type, owner_employee_id")
        .eq("id", vehicle_id)
        .maybeSingle();
      if (vehCheckErr) throw vehCheckErr;
      if (!vehicle) return jsonResponse({ error: "Vehicle not found" }, 404);
      if (vehicle.ownership_type !== "employee" || vehicle.owner_employee_id !== employee_id) {
        return jsonResponse({ error: "This vehicle is not registered as owned by this employee" }, 400);
      }

      const { data: updated, error: updateErr } = await supabase
        .from("employees")
        .update({ assigned_vehicle_id: vehicle_id })
        .eq("id", employee_id)
        .select("id, name, assigned_vehicle_id")
        .single();
      if (updateErr) throw updateErr;

      return jsonResponse({ success: true, employee: updated }, 200);
    }

    if (action === "mark_paid") {
      const { employee_id, period_month, period_year } = body;
      if (!employee_id || !period_month || !period_year) {
        return jsonResponse({ error: "Missing employee_id, period_month, or period_year" }, 400);
      }

      const startDate = `${period_year}-${String(period_month).padStart(2, "0")}-01`;
      const endDate = new Date(period_year, period_month, 0).toISOString().split("T")[0];

      const { data: approvedEntries, error: entriesErr } = await supabase
        .from("daily_entries")
        .select("*")
        .eq("employee_id", employee_id)
        .eq("status", "approved")
        .gte("entry_date", startDate)
        .lte("entry_date", endDate);
      if (entriesErr) throw entriesErr;

      if (!approvedEntries || approvedEntries.length === 0) {
        return jsonResponse({ error: "No approved entries found for this employee in this period" }, 400);
      }

      const totalKm = approvedEntries.reduce((sum, e) => sum + Number(e.km_traveled || 0), 0);
      const totalCost = approvedEntries.reduce((sum, e) => sum + Number(e.cost || 0), 0);

      const { data: batch, error: batchErr } = await supabase
        .from("payment_batches")
        .insert({
          employee_id,
          period_month,
          period_year,
          total_km: totalKm,
          total_cost: totalCost,
          status: "paid",
          paid_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (batchErr) throw batchErr;

      const entryIds = approvedEntries.map((e) => e.id);
      const { error: updateEntriesErr } = await supabase
        .from("daily_entries")
        .update({ status: "paid", payment_batch_id: batch.id, updated_at: new Date().toISOString() })
        .in("id", entryIds);
      if (updateEntriesErr) throw updateEntriesErr;

      return jsonResponse({ success: true, batch, entries: approvedEntries }, 200);
    }

    if (action === "get_slip") {
      const { batch_id } = body;
      if (!batch_id) return jsonResponse({ error: "Missing batch_id" }, 400);

      const { data: batch, error: batchErr } = await supabase
        .from("payment_batches")
        .select("*, employees!payment_batches_employee_id_fkey(name, mobile_number)")
        .eq("id", batch_id)
        .single();
      if (batchErr) throw batchErr;

      const { data: entries, error: entriesErr } = await supabase
        .from("daily_entries")
        .select("entry_date, km_traveled, rate_applied, cost, vehicles(vehicle_name)")
        .eq("payment_batch_id", batch_id)
        .order("entry_date", { ascending: true });
      if (entriesErr) throw entriesErr;

      return jsonResponse({ success: true, batch, entries }, 200);
    }

    if (action === "approve_entry") {
      const { entry_id } = body;
      if (!entry_id) return jsonResponse({ error: "Missing entry_id" }, 400);

      const { data: entry, error: fetchErr } = await supabase
        .from("daily_entries")
        .select("id, status")
        .eq("id", entry_id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!entry) return jsonResponse({ error: "Entry not found" }, 404);
      if (entry.status !== "calculated") {
        return jsonResponse({ error: `Cannot approve an entry with status '${entry.status}'` }, 400);
      }

      const { data: updated, error: updateErr } = await supabase
        .from("daily_entries")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", entry_id)
        .select()
        .single();
      if (updateErr) throw updateErr;

      return jsonResponse({ success: true, entry: updated }, 200);
    }

    if (action === "reject_entry") {
      const { entry_id, reason } = body;
      if (!entry_id) return jsonResponse({ error: "Missing entry_id" }, 400);
      if (!reason || !reason.trim()) {
        return jsonResponse({ error: "A reason is required to reject an entry" }, 400);
      }

      const { data: entry, error: fetchErr } = await supabase
        .from("daily_entries")
        .select("id, status")
        .eq("id", entry_id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!entry) return jsonResponse({ error: "Entry not found" }, 404);
      if (entry.status !== "calculated") {
        return jsonResponse({ error: `Cannot reject an entry with status '${entry.status}'` }, 400);
      }

      const { data: updated, error: updateErr } = await supabase
        .from("daily_entries")
        .update({
          status: "rejected",
          rejection_reason: reason.trim(),
          rejected_by: requester_id,
          rejected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", entry_id)
        .select()
        .single();
      if (updateErr) throw updateErr;

      return jsonResponse({ success: true, entry: updated }, 200);
    }

    if (action === "add_vehicle") {
      const { vehicle_name, ownership_type, rate_per_km, owner_employee_id } = body;
      if (!vehicle_name || !ownership_type) {
        return jsonResponse({ error: "Vehicle name and ownership type are required" }, 400);
      }
      if (!["company", "employee"].includes(ownership_type)) {
        return jsonResponse({ error: "Invalid ownership type" }, 400);
      }
      if (ownership_type === "company" && !rate_per_km) {
        return jsonResponse({ error: "Rate per km is required for company-owned vehicles" }, 400);
      }
      if (ownership_type === "employee" && !owner_employee_id) {
        return jsonResponse({ error: "Owner employee is required for employee-owned vehicles" }, 400);
      }

      const { data: newVeh, error: insertErr } = await supabase
        .from("vehicles")
        .insert({
          vehicle_name,
          ownership_type,
          rate_per_km: ownership_type === "company" ? rate_per_km : null,
          owner_employee_id: ownership_type === "employee" ? owner_employee_id : null,
          is_active: true,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      return jsonResponse({ success: true, vehicle: newVeh }, 200);
    }

    if (action === "update_settings") {
      const { max_daily_km } = body;
      if (!max_daily_km || Number(max_daily_km) <= 0) {
        return jsonResponse({ error: "Invalid max daily km value" }, 400);
      }

      const { data: updated, error: updateErr } = await supabase
        .from("app_settings")
        .update({ max_daily_km, updated_at: new Date().toISOString() })
        .eq("id", 1)
        .select()
        .single();
      if (updateErr) throw updateErr;

      return jsonResponse({ success: true, settings: updated }, 200);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
