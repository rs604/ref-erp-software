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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const {
      employee_id,
      entry_type,
      reading,
      photo_base64,
      location_text,
      lat,
      lng,
    } = await req.json();

    if (!employee_id || !entry_type || reading === undefined || reading === null) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }
    if (!location_text || lat === undefined || lng === undefined) {
      return jsonResponse({ error: "Location is required to submit a reading" }, 400);
    }
    if (!["morning", "evening"].includes(entry_type)) {
      return jsonResponse({ error: "Invalid entry type" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: employeeRow, error: employeeErr } = await supabase
      .from("employees")
      .select("id, status, assigned_vehicle_id, rate_per_km")
      .eq("id", employee_id)
      .maybeSingle();
    if (employeeErr) throw employeeErr;
    if (!employeeRow || employeeRow.status !== "active") {
      return jsonResponse({ error: "Not authorized" }, 403);
    }
    if (!employeeRow.assigned_vehicle_id) {
      return jsonResponse({ error: "No vehicle is assigned to your account yet. Contact admin." }, 400);
    }
    const vehicle_id = employeeRow.assigned_vehicle_id;

    const today = new Date().toISOString().split("T")[0];
    const newReading = Number(reading);

    const { data: existing, error: fetchErr } = await supabase
      .from("daily_entries")
      .select("*")
      .eq("employee_id", employee_id)
      .eq("entry_date", today)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    const { data: lastEntries, error: lastErr } = await supabase
      .from("daily_entries")
      .select("entry_date, morning_reading, evening_reading")
      .eq("vehicle_id", vehicle_id)
      .order("entry_date", { ascending: false })
      .limit(5);

    if (lastErr) throw lastErr;

    let lastKnownReading: number | null = null;
    for (const row of lastEntries || []) {
      if (row.entry_date === today && entry_type === "morning") continue;
      if (row.evening_reading !== null && row.evening_reading !== undefined) {
        lastKnownReading = Number(row.evening_reading);
        break;
      }
      if (row.morning_reading !== null && row.morning_reading !== undefined) {
        lastKnownReading = Number(row.morning_reading);
        break;
      }
    }

    if (entry_type === "morning") {
      if (existing && existing.morning_reading !== null) {
        return jsonResponse({ error: "Morning reading already submitted for today" }, 409);
      }

      if (lastKnownReading !== null && newReading < lastKnownReading) {
        return jsonResponse(
          {
            error: `Reading (${newReading}) cannot be less than this vehicle's last recorded reading (${lastKnownReading}). Please check the odometer and re-enter.`,
          },
          400
        );
      }
    }

    if (entry_type === "evening") {
      if (!existing || existing.morning_reading === null) {
        return jsonResponse({ error: "You must submit a morning reading first" }, 400);
      }
      if (existing.evening_reading !== null) {
        return jsonResponse({ error: "Evening reading already submitted for today" }, 409);
      }

      const morningReading = Number(existing.morning_reading);
      if (newReading < morningReading) {
        return jsonResponse(
          {
            error: `Evening reading (${newReading}) cannot be less than morning reading (${morningReading}). Please check and re-enter.`,
          },
          400
        );
      }

      const { data: settings, error: settingsErr } = await supabase
        .from("app_settings")
        .select("max_daily_km")
        .eq("id", 1)
        .single();

      if (settingsErr) throw settingsErr;

      const maxDailyKm = Number(settings.max_daily_km);
      const kmTraveled = newReading - morningReading;

      if (kmTraveled > maxDailyKm) {
        return jsonResponse(
          {
            error: `Distance traveled (${kmTraveled} km) exceeds the allowed daily limit of ${maxDailyKm} km. Please check the readings and re-enter, or contact admin if this is correct.`,
          },
          400
        );
      }
    }

    let photoPath: string | null = null;
    if (photo_base64) {
      const base64Data = photo_base64.includes(",") ? photo_base64.split(",")[1] : photo_base64;
      const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
      photoPath = `${employee_id}/${today}_${entry_type}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from("vehicle-km-photos")
        .upload(photoPath, binaryData, { contentType: "image/jpeg", upsert: true });

      if (uploadErr) {
        photoPath = null;
      }
    }

    const nowIso = new Date().toISOString();

    if (entry_type === "morning") {
      const { data: upserted, error: upsertErr } = await supabase
        .from("daily_entries")
        .upsert(
          {
            employee_id,
            vehicle_id,
            entry_date: today,
            morning_reading: newReading,
            morning_photo_url: photoPath,
            morning_photo_missing: !photoPath,
            morning_location_text: location_text,
            morning_lat: lat,
            morning_lng: lng,
            morning_timestamp: nowIso,
            status: "pending_evening",
          },
          { onConflict: "employee_id,entry_date" }
        )
        .select()
        .single();

      if (upsertErr) throw upsertErr;
      return jsonResponse({ success: true, entry: upserted }, 200);
    }

    const morningReading = Number(existing.morning_reading);

    const { data: vehicle, error: vehicleErr } = await supabase
      .from("vehicles")
      .select("ownership_type, rate_per_km, owner_employee_id")
      .eq("id", vehicle_id)
      .single();

    if (vehicleErr) throw vehicleErr;

    let rateApplied: number;
    if (vehicle.ownership_type === "company") {
      rateApplied = Number(vehicle.rate_per_km);
    } else {
      rateApplied = Number(employeeRow.rate_per_km);
    }

    const kmTraveled = newReading - morningReading;
    const cost = kmTraveled * rateApplied;

    const { data: updated, error: updateErr } = await supabase
      .from("daily_entries")
      .update({
        evening_reading: newReading,
        evening_photo_url: photoPath,
        evening_photo_missing: !photoPath,
        evening_location_text: location_text,
        evening_lat: lat,
        evening_lng: lng,
        evening_timestamp: nowIso,
        km_traveled: kmTraveled,
        rate_applied: rateApplied,
        cost: cost,
        status: "calculated",
        updated_at: nowIso,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (updateErr) throw updateErr;
    return jsonResponse({ success: true, entry: updated }, 200);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
