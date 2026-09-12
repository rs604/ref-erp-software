// get-vehicles — the list of vehicles in use.
// Any active employee may see it; the caller comes from the token.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, handle, json, requireActiveEmployee } from "../_shared/auth.ts";

Deno.serve((req) => handle(req, async () => {
  const me = await authenticate(req);
  requireActiveEmployee(me);

  const { data: vehicles, error } = await me.admin
    .from("vehicles")
    .select("id, vehicle_number, vehicle_name, ownership_type, rate_per_km, owner_party_id")
    .eq("status", "approved")
    .order("vehicle_name", { ascending: true });
  if (error) throw error;

  return json({ success: true, vehicles }, 200);
}));
