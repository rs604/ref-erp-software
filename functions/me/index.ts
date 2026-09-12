// ============================================================
// me — who is calling, and what are they allowed to do
//
// Every screen calls this once after sign-in to build its menu.
//
// The important difference from the old Tokyo functions:
//   Tokyo trusted an employee id sent in the request body. Anyone who
//   knew a UUID could act as that person. This function takes the
//   caller's identity ONLY from the signed token that Supabase Auth
//   issued, which cannot be forged or guessed.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // ---- 1. Who is this? Straight from the signed token, nowhere else. ----
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);

    const authUserId = userData.user.id;

    // ---- 2. Find the person behind the login ----
    const { data: account, error: accErr } = await admin
      .from("user_accounts")
      .select("id, party_id, login_email, two_step_enabled, must_change_password, is_locked, status")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (accErr) throw accErr;

    if (!account) {
      return json({ error: "This login is not linked to an employee record. Contact the owner." }, 403);
    }
    if (account.status !== "approved") {
      return json({ error: "This account is not active. Contact the owner." }, 403);
    }
    if (account.is_locked) {
      return json({ error: "This account is locked. Contact the owner." }, 403);
    }

    const { data: party, error: partyErr } = await admin
      .from("parties")
      .select("id, party_number, display_name, primary_email, primary_mobile, status")
      .eq("id", account.party_id)
      .maybeSingle();
    if (partyErr) throw partyErr;

    // ---- 3. What are they to the business, and what may they do? ----
    const { data: roleRows } = await admin
      .from("party_roles")
      .select("role")
      .eq("party_id", account.party_id)
      .eq("status", "approved");

    const roles = (roleRows ?? []).map((r) => r.role);
    const isOwner = roles.includes("owner");

    let permissions: string[] = [];
    if (isOwner) {
      // The owner holds everything, without needing a row per permission.
      const { data: allPerms } = await admin
        .from("permissions")
        .select("key")
        .eq("status", "approved");
      permissions = (allPerms ?? []).map((p) => p.key);
    } else {
      const { data: granted } = await admin
        .from("party_permissions")
        .select("permissions(key)")
        .eq("party_id", account.party_id)
        .eq("status", "approved");
      permissions = (granted ?? [])
        .map((g: { permissions: { key: string } | null }) => g.permissions?.key)
        .filter((k): k is string => Boolean(k));
    }

    // ---- 4. Employment details, for the Km Tracker and the header ----
    const { data: employee } = await admin
      .from("employee_details")
      .select("employment_state, assigned_vehicle_id, rate_per_km, date_of_joining, branch_id, department_id, designation_id")
      .eq("party_id", account.party_id)
      .maybeSingle();

    // ---- 5. Record that they arrived ----
    await admin.from("login_log").insert({
      event: "login_success",
      login_email: account.login_email,
      auth_user_id: authUserId,
      party_id: account.party_id,
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent"),
    });

    await admin
      .from("user_accounts")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", account.id);

    return json({
      success: true,
      user: {
        party_id: party?.id,
        party_number: party?.party_number,
        name: party?.display_name,
        email: account.login_email,
        mobile: party?.primary_mobile,
        roles,
        is_owner: isOwner,
        permissions,
        must_change_password: account.must_change_password,
        two_step_enabled: account.two_step_enabled,
        employment_state: employee?.employment_state ?? null,
        assigned_vehicle_id: employee?.assigned_vehicle_id ?? null,
      },
    }, 200);
  } catch (err) {
    console.error("me:", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
