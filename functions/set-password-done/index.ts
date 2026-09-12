// ============================================================
// set-password-done — clear the "must change password" flag
//
// Called once, straight after somebody sets their own password.
// It changes nothing except that flag, and only for the person whose
// signed token was presented. There is no way to clear it for anyone
// else, because the caller is never named in the request body.
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
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);

    const authUserId = userData.user.id;

    const { data: account } = await admin
      .from("user_accounts")
      .select("id, party_id, login_email")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (!account) return json({ error: "This login is not linked to an employee record." }, 403);

    await admin
      .from("user_accounts")
      .update({ must_change_password: false, failed_attempts: 0 })
      .eq("id", account.id);

    await admin.from("login_log").insert({
      event: "password_changed",
      login_email: account.login_email,
      auth_user_id: authUserId,
      party_id: account.party_id,
      ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent"),
    });

    return json({ success: true }, 200);
  } catch (err) {
    console.error("set-password-done:", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
