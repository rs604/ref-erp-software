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

    // ---------------- GET MY OWN PERMISSIONS (any active employee, used for nav visibility — not owner-gated) ----------------
    if (action === "get_my_permissions") {
      if (requester.role === "owner") {
        return jsonResponse({ success: true, is_owner: true, permission_keys: [] }, 200);
      }
      const { data: grants, error: grantsErr } = await supabase
        .from("employee_permissions")
        .select("permissions(key)")
        .eq("employee_id", requester_id);
      if (grantsErr) throw grantsErr;
      const keys = (grants || []).map((g: any) => g.permissions?.key).filter(Boolean);
      return jsonResponse({ success: true, is_owner: false, permission_keys: keys }, 200);
    }

    // Everything below this line remains Owner-only, unchanged
    if (requester.role !== "owner") {
      return jsonResponse({ error: "Only the Owner can manage roles and permissions" }, 403);
    }

    if (action === "get_permissions_data") {
      const [permsRes, employeesRes, grantsRes] = await Promise.all([
        supabase.from("permissions").select("*").order("category").order("sub_head").order("action"),
        supabase.from("employees").select("id, name, employee_code, role, status, mobile_number, email, erp_login_enabled, login_mode, departments(name), designations(name)").order("name"),
        supabase.from("employee_permissions").select("employee_id, permission_id"),
      ]);
      if (permsRes.error) throw permsRes.error;
      if (employeesRes.error) throw employeesRes.error;
      if (grantsRes.error) throw grantsRes.error;

      return jsonResponse({
        success: true,
        permissions: permsRes.data,
        employees: employeesRes.data,
        grants: grantsRes.data,
      }, 200);
    }

    if (action === "grant_permission") {
      const { employee_id, permission_id } = body;
      if (!employee_id || !permission_id) return jsonResponse({ error: "Missing employee_id or permission_id" }, 400);

      const { error } = await supabase
        .from("employee_permissions")
        .upsert({ employee_id, permission_id, granted_by: requester_id }, { onConflict: "employee_id,permission_id" });
      if (error) throw error;

      return jsonResponse({ success: true }, 200);
    }

    if (action === "revoke_permission") {
      const { employee_id, permission_id } = body;
      if (!employee_id || !permission_id) return jsonResponse({ error: "Missing employee_id or permission_id" }, 400);

      const { error } = await supabase
        .from("employee_permissions")
        .delete()
        .eq("employee_id", employee_id)
        .eq("permission_id", permission_id);
      if (error) throw error;

      return jsonResponse({ success: true }, 200);
    }

    if (action === "bulk_set_permissions") {
      const { employee_id, permission_ids } = body;
      if (!employee_id || !Array.isArray(permission_ids)) return jsonResponse({ error: "Missing employee_id or permission_ids" }, 400);

      const { error: delErr } = await supabase.from("employee_permissions").delete().eq("employee_id", employee_id);
      if (delErr) throw delErr;

      if (permission_ids.length > 0) {
        const rows = permission_ids.map((pid: string) => ({ employee_id, permission_id: pid, granted_by: requester_id }));
        const { error: insErr } = await supabase.from("employee_permissions").insert(rows);
        if (insErr) throw insErr;
      }

      return jsonResponse({ success: true }, 200);
    }

    // ---------------- SET LOGIN MODE (single/multiple) — Owner only, part of permissions management ----------------
    if (action === "set_login_mode") {
      const { employee_id, login_mode } = body;
      if (!employee_id || !["single", "multiple"].includes(login_mode)) {
        return jsonResponse({ error: "Missing employee_id or invalid login_mode" }, 400);
      }
      const { error } = await supabase.from("employees").update({ login_mode }).eq("id", employee_id);
      if (error) throw error;
      // Switching to single-login should immediately drop any extra active sessions beyond the most recent
      if (login_mode === "single") {
        const { data: sessions } = await supabase.from("employee_sessions").select("id, created_at").eq("employee_id", employee_id).order("created_at", { ascending: false });
        if (sessions && sessions.length > 1) {
          const idsToRemove = sessions.slice(1).map((s: any) => s.id);
          await supabase.from("employee_sessions").delete().in("id", idsToRemove);
        }
      }
      return jsonResponse({ success: true }, 200);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
