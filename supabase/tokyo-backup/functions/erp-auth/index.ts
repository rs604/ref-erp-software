import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const ALLOWED_DOMAINS = ["refconveyors.com", "refconveyors.net"];

function isAllowedDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && ALLOWED_DOMAINS.includes(domain);
}

// Min 8 chars, at least one letter, one number, one symbol
function isStrongPassword(pw: string): boolean {
  if (!pw || pw.length < 8) return false;
  if (!/[a-zA-Z]/.test(pw)) return false;
  if (!/[0-9]/.test(pw)) return false;
  if (!/[^a-zA-Z0-9]/.test(pw)) return false;
  return true;
}

function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

async function sendResetEmail(toEmail: string, name: string, resetLink: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "REF ERP <noreply@refconveyors.net>",
      to: toEmail,
      subject: "Reset your REF ERP password",
      html: `<p>Hi ${name},</p><p>Click the link below to reset your REF ERP password. This link expires in 30 minutes.</p><p><a href="${resetLink}">Reset Password</a></p><p>If you didn't request this, you can safely ignore this email — your password will not be changed.</p>`,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Failed to send reset email: " + errText);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { action } = body;
    if (!action) return jsonResponse({ error: "Missing action" }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ---------------- LOGIN ----------------
    if (action === "login") {
      const { email, password } = body;
      if (!email || !password) return jsonResponse({ error: "Email and password are required" }, 400);
      const normalizedEmail = email.toLowerCase().trim();

      if (!isAllowedDomain(normalizedEmail)) {
        return jsonResponse({ error: "Only @refconveyors.com or @refconveyors.net email addresses can access the ERP" }, 403);
      }

      const { data: emp, error: empErr } = await supabase.from("employees").select("*").eq("email", normalizedEmail).maybeSingle();
      if (empErr) throw empErr;
      // Generic message either way — never reveal whether an email exists
      if (!emp || !emp.erp_login_enabled || !emp.password_hash) {
        return jsonResponse({ error: "Invalid email or password" }, 401);
      }
      if (emp.status !== "active") {
        return jsonResponse({ error: "This account is not active. Contact your administrator." }, 403);
      }

      const matches = await bcrypt.compare(password, emp.password_hash);
      if (!matches) return jsonResponse({ error: "Invalid email or password" }, 401);

      // Single-login mode: any existing session for this employee is invalidated by a new login
      if (emp.login_mode === "single") {
        await supabase.from("employee_sessions").delete().eq("employee_id", emp.id);
      }

      const token = generateToken();
      const { error: sessErr } = await supabase.from("employee_sessions").insert({ employee_id: emp.id, token });
      if (sessErr) throw sessErr;

      return jsonResponse({
        success: true,
        token,
        employee: { id: emp.id, name: emp.name, email: emp.email, role: emp.role, must_change_password: emp.must_change_password },
      }, 200);
    }

    // ---------------- VALIDATE SESSION (checked on every page load, and can be reused by other functions later) ----------------
    if (action === "validate_session") {
      const { token } = body;
      if (!token) return jsonResponse({ valid: false }, 200);

      const { data: session } = await supabase.from("employee_sessions").select("*, employees(*)").eq("token", token).maybeSingle();
      if (!session || !session.employees) return jsonResponse({ valid: false }, 200);
      if (session.employees.status !== "active" || !session.employees.erp_login_enabled) {
        await supabase.from("employee_sessions").delete().eq("id", session.id);
        return jsonResponse({ valid: false }, 200);
      }

      const { data: settings } = await supabase.from("app_settings").select("session_timeout_minutes").limit(1).maybeSingle();
      const timeoutMinutes = settings?.session_timeout_minutes || 480;
      const lastActiveMs = new Date(session.last_active_at).getTime();
      if (Date.now() - lastActiveMs > timeoutMinutes * 60000) {
        await supabase.from("employee_sessions").delete().eq("id", session.id);
        return jsonResponse({ valid: false, reason: "idle_timeout" }, 200);
      }

      await supabase.from("employee_sessions").update({ last_active_at: new Date().toISOString() }).eq("id", session.id);
      const emp = session.employees;
      return jsonResponse({
        valid: true,
        employee: { id: emp.id, name: emp.name, email: emp.email, role: emp.role, must_change_password: emp.must_change_password },
      }, 200);
    }

    // ---------------- LOGOUT ----------------
    if (action === "logout") {
      const { token } = body;
      if (token) await supabase.from("employee_sessions").delete().eq("token", token);
      return jsonResponse({ success: true }, 200);
    }

    // ---------------- REQUEST PASSWORD RESET ----------------
    if (action === "request_password_reset") {
      const { email } = body;
      if (!email) return jsonResponse({ error: "Email is required" }, 400);
      const normalizedEmail = email.toLowerCase().trim();
      const genericResponse = { success: true, message: "If that email has ERP access, a reset link has been sent." };

      const { data: emp } = await supabase.from("employees").select("id, name, email, erp_login_enabled, status").eq("email", normalizedEmail).maybeSingle();
      // Always return the same generic response whether or not the email exists — never leak which emails are registered
      if (!emp || !emp.erp_login_enabled || emp.status !== "active") {
        return jsonResponse(genericResponse, 200);
      }

      const token = generateToken();
      const expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
      const { error: insErr } = await supabase.from("password_reset_tokens").insert({ employee_id: emp.id, token, expires_at: expiresAt });
      if (insErr) throw insErr;

      const resetLink = `https://km.refconveyors.net/admin.html?reset_token=${token}`;
      try {
        await sendResetEmail(emp.email, emp.name, resetLink);
      } catch (e) {
        console.error("Reset email send failed:", e);
        // Still return generic success to the client — don't reveal internal failures either
      }

      return jsonResponse(genericResponse, 200);
    }

    // ---------------- RESET PASSWORD (via emailed link) ----------------
    if (action === "reset_password") {
      const { reset_token, new_password } = body;
      if (!reset_token || !new_password) return jsonResponse({ error: "Missing reset token or new password" }, 400);
      if (!isStrongPassword(new_password)) {
        return jsonResponse({ error: "Password must be at least 8 characters and include a letter, a number, and a symbol" }, 400);
      }

      const { data: rt } = await supabase.from("password_reset_tokens").select("*").eq("token", reset_token).maybeSingle();
      if (!rt || rt.used || new Date(rt.expires_at) < new Date()) {
        return jsonResponse({ error: "This reset link is invalid or has expired. Please request a new one." }, 400);
      }

      const hash = await bcrypt.hash(new_password, 10);
      const { error: updErr } = await supabase.from("employees").update({ password_hash: hash, must_change_password: false }).eq("id", rt.employee_id);
      if (updErr) throw updErr;
      await supabase.from("password_reset_tokens").update({ used: true }).eq("id", rt.id);
      // Force re-login everywhere — a password reset should invalidate any existing sessions
      await supabase.from("employee_sessions").delete().eq("employee_id", rt.employee_id);

      return jsonResponse({ success: true }, 200);
    }

    // ---------------- CHANGE PASSWORD (forced on first login, using the just-established session) ----------------
    if (action === "change_password") {
      const { token, new_password } = body;
      if (!token || !new_password) return jsonResponse({ error: "Missing session or new password" }, 400);
      if (!isStrongPassword(new_password)) {
        return jsonResponse({ error: "Password must be at least 8 characters and include a letter, a number, and a symbol" }, 400);
      }

      const { data: session } = await supabase.from("employee_sessions").select("employee_id").eq("token", token).maybeSingle();
      if (!session) return jsonResponse({ error: "Your session has expired. Please log in again." }, 401);

      const hash = await bcrypt.hash(new_password, 10);
      const { error: updErr } = await supabase.from("employees").update({ password_hash: hash, must_change_password: false }).eq("id", session.employee_id);
      if (updErr) throw updErr;

      return jsonResponse({ success: true }, 200);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
