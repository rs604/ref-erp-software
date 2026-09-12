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
    const { employee_id } = await req.json();
    if (!employee_id) return jsonResponse({ error: "Missing employee_id" }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, status")
      .eq("id", employee_id)
      .maybeSingle();
    if (empErr) throw empErr;
    if (!employee || employee.status !== "active") {
      return jsonResponse({ error: "Not authorized" }, 403);
    }

    const { data: vehicles, error: vehErr } = await supabase
      .from("vehicles")
      .select("id, vehicle_name")
      .eq("is_active", true)
      .order("vehicle_name", { ascending: true });
    if (vehErr) throw vehErr;

    return jsonResponse({ success: true, vehicles }, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
