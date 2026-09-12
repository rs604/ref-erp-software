// get-my-vehicle — which vehicle is this driver on today.
// The caller is never named in the request. It is taken from the token.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, handle, json, requireActiveEmployee } from "../_shared/auth.ts";

Deno.serve((req) => handle(req, async () => {
  const me = await authenticate(req);
  requireActiveEmployee(me);

  if (!me.assignedVehicleId) {
    return json({ success: true, vehicle: null }, 200);
  }

  const { data: vehicle, error } = await me.admin
    .from("vehicles")
    .select("id, vehicle_number, vehicle_name, ownership_type, rate_per_km")
    .eq("id", me.assignedVehicleId)
    .maybeSingle();
  if (error) throw error;

  return json({ success: true, vehicle }, 200);
}));
