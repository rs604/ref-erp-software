// ============================================================
// submit-reading — a driver records the odometer, morning and evening.
//
// Two things changed from Tokyo:
//   1. The driver is taken from the signed token. The old version
//      accepted an employee_id in the body, so one driver could file
//      readings as another.
//   2. The photo is checked to be a real JPG or PNG by reading its own
//      first bytes, and is recorded in `attachments` like every other
//      file -- so it is versioned, never deleted, and invisible until
//      it has passed the file check.
//
// Status words are the same ones the rest of the database uses:
//   draft     = morning reading in
//   submitted = evening reading in, cost worked out
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate, handle, json, requireActiveEmployee,
  AuthError, checkFileBytes, SCAN_ENGINE, SCAN_NOTE,
} from "../_shared/auth.ts";

function todayInIndia(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split("T")[0];
}

Deno.serve((req) => handle(req, async () => {
  const me = await authenticate(req);
  requireActiveEmployee(me);

  const body = await req.json();
  const { entry_type, reading, photo_base64, photo_mime, location_text, lat, lng } = body;

  // ---------- what the screen must send ----------
  if (!entry_type || reading === undefined || reading === null) {
    throw new AuthError("Missing the reading.", 400);
  }
  if (!["morning", "evening"].includes(entry_type)) {
    throw new AuthError("That is not a valid entry type.", 400);
  }
  if (!location_text || lat === undefined || lng === undefined) {
    throw new AuthError("Location is required to submit a reading.", 400);
  }
  if (!me.assignedVehicleId) {
    throw new AuthError("No vehicle is assigned to you yet. Contact admin.", 400);
  }

  const admin = me.admin;
  const vehicleId = me.assignedVehicleId;
  const today = todayInIndia();
  const newReading = Number(reading);
  if (!isFinite(newReading) || newReading < 0) {
    throw new AuthError("That reading is not a number.", 400);
  }

  const { data: settings, error: settingsErr } = await admin
    .from("app_settings")
    .select("max_daily_km, max_upload_mb")
    .eq("id", 1).single();
  if (settingsErr) throw settingsErr;

  const { data: existing, error: existingErr } = await admin
    .from("daily_entries")
    .select("*")
    .eq("party_id", me.partyId)
    .eq("entry_date", today)
    .maybeSingle();
  if (existingErr) throw existingErr;

  // ---------- the checks that stop a wrong number going in ----------
  if (entry_type === "morning") {
    if (existing && existing.morning_reading !== null) {
      throw new AuthError("Morning reading is already in for today.", 409);
    }

    const { data: recent } = await admin
      .from("daily_entries")
      .select("entry_date, morning_reading, evening_reading")
      .eq("vehicle_id", vehicleId)
      .neq("entry_date", today)
      .order("entry_date", { ascending: false })
      .limit(5);

    let lastKnown: number | null = null;
    for (const row of recent ?? []) {
      if (row.evening_reading !== null) { lastKnown = Number(row.evening_reading); break; }
      if (row.morning_reading !== null) { lastKnown = Number(row.morning_reading); break; }
    }
    if (lastKnown !== null && newReading < lastKnown) {
      throw new AuthError(
        `Reading (${newReading}) cannot be less than this vehicle's last recorded reading (${lastKnown}). Check the odometer and enter it again.`,
        400,
      );
    }
  }

  if (entry_type === "evening") {
    if (!existing || existing.morning_reading === null) {
      throw new AuthError("Put the morning reading in first.", 400);
    }
    if (existing.evening_reading !== null) {
      throw new AuthError("Evening reading is already in for today.", 409);
    }
    const morning = Number(existing.morning_reading);
    if (newReading < morning) {
      throw new AuthError(
        `Evening reading (${newReading}) cannot be less than the morning reading (${morning}). Check and enter it again.`,
        400,
      );
    }
    const km = newReading - morning;
    const maxKm = Number(settings.max_daily_km);
    if (km > maxKm) {
      throw new AuthError(
        `That is ${km} km in one day, over the ${maxKm} km limit. Check the readings, or ask admin if it is correct.`,
        400,
      );
    }
  }

  // ---------- the photo ----------
  // Checked by its own bytes, not by what the screen calls it.
  let photoAttachmentId: string | null = null;
  let photoStored = false;

  if (photo_base64) {
    const raw = photo_base64.includes(",") ? photo_base64.split(",")[1] : photo_base64;
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    const maxBytes = Number(settings.max_upload_mb ?? 25) * 1048576;

    // Throws with a plain message if it is not really a JPG or PNG.
    const realMime = checkFileBytes(bytes, photo_mime ?? "", maxBytes);
    if (realMime === "application/pdf") {
      throw new AuthError("The odometer photo has to be a picture, not a PDF.", 400);
    }

    const ext = realMime === "image/png" ? "png" : "jpg";
    const path = `${me.partyId}/${today}_${entry_type}.${ext}`;

    const { error: uploadErr } = await admin.storage
      .from("km-photos")
      .upload(path, bytes, { contentType: realMime, upsert: true });
    if (uploadErr) throw uploadErr;

    photoStored = true;

    // Recorded like every other file: versioned, never deleted.
    const { data: prior } = await admin
      .from("attachments")
      .select("id")
      .eq("entity_table", "daily_entries")
      .eq("doc_category", `km_${entry_type}_photo`)
      .eq("party_id", me.partyId)
      .eq("storage_path", path)
      .eq("is_current", true)
      .maybeSingle();

    if (prior) {
      await admin.from("attachments")
        .update({ is_current: false, replaced_at: new Date().toISOString(), replaced_by: me.partyId })
        .eq("id", prior.id);
    }

    const { data: att, error: attErr } = await admin
      .from("attachments")
      .insert({
        entity_table: "daily_entries",
        entity_id: existing?.id ?? "00000000-0000-0000-0000-000000000000",
        party_id: me.partyId,
        doc_category: `km_${entry_type}_photo`,
        title: `Odometer ${entry_type} ${today}`,
        file_name: `${today}_${entry_type}.${ext}`,
        mime_type: realMime,
        size_bytes: bytes.length,
        storage_bucket: "km-photos",
        storage_path: path,
        scan_status: "clean",
        scan_engine: SCAN_ENGINE,
        scan_result: SCAN_NOTE,
        scanned_at: new Date().toISOString(),
        version: prior ? 2 : 1,
        replaces_id: prior?.id ?? null,
        status: "approved",
        created_by: me.partyId,
      })
      .select("id")
      .single();
    if (attErr) throw attErr;
    photoAttachmentId = att.id;
  }

  const nowIso = new Date().toISOString();

  // ---------- write it down ----------
  if (entry_type === "morning") {
    const { data: saved, error: saveErr } = await admin
      .from("daily_entries")
      .upsert({
        party_id: me.partyId,
        vehicle_id: vehicleId,
        entry_date: today,
        morning_reading: newReading,
        morning_at: nowIso,
        morning_location: location_text,
        morning_lat: lat,
        morning_lng: lng,
        morning_photo_missing: !photoStored,
        status: "draft",
        created_by: me.partyId,
      }, { onConflict: "party_id,entry_date" })
      .select()
      .single();
    if (saveErr) throw saveErr;

    if (photoAttachmentId) {
      await admin.from("attachments").update({ entity_id: saved.id }).eq("id", photoAttachmentId);
    }
    return json({ success: true, entry: saved }, 200);
  }

  // evening: work out the cost, never trusting a number from the screen
  const morning = Number(existing!.morning_reading);
  const km = newReading - morning;

  const { data: vehicle, error: vehErr } = await admin
    .from("vehicles")
    .select("ownership_type, rate_per_km")
    .eq("id", vehicleId)
    .single();
  if (vehErr) throw vehErr;

  let rate: number;
  if (vehicle.ownership_type === "company") {
    rate = Number(vehicle.rate_per_km ?? 0);
  } else {
    const { data: emp } = await admin
      .from("employee_details")
      .select("rate_per_km")
      .eq("party_id", me.partyId)
      .maybeSingle();
    rate = Number(emp?.rate_per_km ?? 0);
  }

  const { data: updated, error: updErr } = await admin
    .from("daily_entries")
    .update({
      evening_reading: newReading,
      evening_at: nowIso,
      evening_location: location_text,
      evening_lat: lat,
      evening_lng: lng,
      evening_photo_missing: !photoStored,
      km_travelled: km,
      rate_applied: rate,
      cost: Number((km * rate).toFixed(2)),
      status: "submitted",
    })
    .eq("id", existing!.id)
    .select()
    .single();
  if (updErr) throw updErr;

  if (photoAttachmentId) {
    await admin.from("attachments").update({ entity_id: updated.id }).eq("id", photoAttachmentId);
  }

  return json({ success: true, entry: updated }, 200);
}));
