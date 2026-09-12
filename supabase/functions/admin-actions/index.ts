// ============================================================
// admin-actions — the Km Tracker admin screen's one back door.
//
// What changed from Tokyo, and why:
//
//  1. IDENTITY. The old version read `requester_id` out of the request
//     body and believed it. Anyone who knew an admin's UUID had admin
//     powers. There is no `requester_id` in this file. The caller comes
//     only from `authenticate(req)`, which reads the signed token.
//     Any identity field that arrives in the body is ignored outright.
//
//  2. PERMISSION. `role in ('admin','owner')` is gone. Each action asks
//     for the one permission key it needs. Owner passes everything --
//     the shared helper handles that.
//
//  3. SHAPE. The employee is now `parties` + `employee_details` +
//     `party_roles`. The screen has not been rewritten yet, so every
//     reply carries the old field names it reads (`name`,
//     `mobile_number`, `employee_id`, `km_traveled`, `owner_employee_id`,
//     ...) alongside the real new ones. When the screen is rewritten the
//     legacy aliases come out and nothing else changes.
//
//  4. MONEY. Distance and cost are worked out here from the readings and
//     the rate on file. A number in the request body is never used.
//
//  5. NOTHING IS DELETED. A removal is `status = 'cancelled'` or
//     `employment_state = 'left'`.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate, handle, json, requireActiveEmployee, requirePermission,
  AuthError, type Caller,
} from "../_shared/auth.ts";

// ---------- status words ----------
// The database speaks the shared words. The screen still speaks the old
// Km Tracker ones. Translate both ways so neither has to change today.
//   draft     = morning only          (was pending_evening)
//   submitted = evening in, costed    (was calculated)
//   approved  = checked               (was approved)
//   completed = paid                  (was paid)
//   cancelled = rejected              (was rejected)
const NEW_FROM_OLD: Record<string, string> = {
  pending_evening: "draft",
  calculated: "submitted",
  approved: "approved",
  paid: "completed",
  rejected: "cancelled",
};
const OLD_FROM_NEW: Record<string, string> = {
  draft: "pending_evening",
  submitted: "calculated",
  approved: "approved",
  completed: "paid",
  cancelled: "rejected",
};

/** Accepts either vocabulary, returns the word the database stores. */
function toNewStatus(word: unknown): string | null {
  if (typeof word !== "string" || !word) return null;
  if (OLD_FROM_NEW[word]) return word;          // already a new word
  return NEW_FROM_OLD[word] ?? null;            // an old word from the screen
}
/** The old word, handed back beside the new one so the screen still reads. */
function legacyStatus(word: string): string {
  return OLD_FROM_NEW[word] ?? word;
}

const PHOTO_BUCKET = "km-photos";
const SIGNED_URL_SECONDS = 600;     // short-lived on purpose

function today(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split("T")[0];
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().split("T")[0];
}

/** A uuid the caller sent us. Only ever used to name a *row*, never a person's rights. */
function uuidArg(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) {
      return c;
    }
  }
  return null;
}

// ---------- photos ----------
// Only a file that has passed the check is ever handed out. `scan_status`
// must be 'clean'; a pending, errored or infected file returns no URL at all.
async function signedPhotoUrls(
  admin: Caller["admin"],
  entryIds: string[],
): Promise<Map<string, { morning: string | null; evening: string | null }>> {
  const out = new Map<string, { morning: string | null; evening: string | null }>();
  if (entryIds.length === 0) return out;

  const { data: atts, error } = await admin
    .from("attachments")
    .select("entity_id, doc_category, storage_path, scan_status, is_current")
    .eq("entity_table", "daily_entries")
    .in("entity_id", entryIds)
    .in("doc_category", ["km_morning_photo", "km_evening_photo"])
    .eq("is_current", true)
    .eq("scan_status", "clean")
    .eq("storage_bucket", PHOTO_BUCKET);
  if (error) throw error;

  const rows = (atts ?? []).filter((a) => a.scan_status === "clean" && a.is_current);
  if (rows.length === 0) return out;

  const paths = [...new Set(rows.map((r) => r.storage_path as string))];
  const { data: signed } = await admin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_SECONDS);

  const urlByPath = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.signedUrl && !s.error) urlByPath.set(s.path as string, s.signedUrl);
  }

  for (const r of rows) {
    const slot = out.get(r.entity_id as string) ?? { morning: null, evening: null };
    const url = urlByPath.get(r.storage_path as string) ?? null;
    if (r.doc_category === "km_morning_photo") slot.morning = url;
    else slot.evening = url;
    out.set(r.entity_id as string, slot);
  }
  return out;
}

// ---------- the rate that applies to one entry ----------
// Company vehicle: the vehicle's rate. Employee's own vehicle: the rate on
// that employee's record. Never a rate from the request.
async function rateFor(
  admin: Caller["admin"],
  vehicleId: string,
  partyId: string,
): Promise<number> {
  const { data: vehicle, error } = await admin
    .from("vehicles")
    .select("ownership_type, rate_per_km")
    .eq("id", vehicleId)
    .maybeSingle();
  if (error) throw error;
  if (!vehicle) return 0;

  if (vehicle.ownership_type === "company") return Number(vehicle.rate_per_km ?? 0);

  const { data: emp } = await admin
    .from("employee_details")
    .select("rate_per_km")
    .eq("party_id", partyId)
    .maybeSingle();
  return Number(emp?.rate_per_km ?? 0);
}

/** Works the money out again from the readings on file. */
function recompute(entry: Record<string, unknown>, rate: number) {
  const m = entry.morning_reading === null || entry.morning_reading === undefined
    ? null : Number(entry.morning_reading);
  const e = entry.evening_reading === null || entry.evening_reading === undefined
    ? null : Number(entry.evening_reading);
  if (m === null || e === null) return null;
  const km = Number((e - m).toFixed(2));
  return { km_travelled: km, rate_applied: rate, cost: Number((km * rate).toFixed(2)) };
}

/** One entry, dressed in both vocabularies. */
function shapeEntry(
  e: Record<string, unknown>,
  people: Map<string, { name: string; mobile: string | null }>,
  vehicleNames: Map<string, string>,
  photos: Map<string, { morning: string | null; evening: string | null }>,
) {
  const person = people.get(e.party_id as string);
  const photo = photos.get(e.id as string) ?? { morning: null, evening: null };
  return {
    ...e,
    status: e.status,                                  // the new word
    legacy_status: legacyStatus(e.status as string),   // the old word
    employee_id: e.party_id,                           // legacy alias
    km_traveled: e.km_travelled,                       // legacy spelling
    morning_timestamp: e.morning_at,
    evening_timestamp: e.evening_at,
    morning_location_text: e.morning_location,
    evening_location_text: e.evening_location,
    employees: person ? { name: person.name, mobile_number: person.mobile } : null,
    parties: person ? { display_name: person.name, primary_mobile: person.mobile } : null,
    vehicles: { vehicle_name: vehicleNames.get(e.vehicle_id as string) ?? null },
    morning_photo_signed_url: photo.morning,
    evening_photo_signed_url: photo.evening,
  };
}

/** Everyone who is a person on the books, with the old employee fields. */
async function loadPeople(admin: Caller["admin"]) {
  const { data: roleRows, error: roleErr } = await admin
    .from("party_roles")
    .select("party_id, role")
    .eq("status", "approved");
  if (roleErr) throw roleErr;

  const rolesByParty = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    const list = rolesByParty.get(r.party_id as string) ?? [];
    list.push(r.role as string);
    rolesByParty.set(r.party_id as string, list);
  }

  const staffIds = [...rolesByParty.entries()]
    .filter(([, roles]) => roles.includes("employee") || roles.includes("owner"))
    .map(([id]) => id);

  const { data: parties, error: pErr } = await admin
    .from("parties")
    .select("id, display_name, party_number, primary_mobile, primary_email, status, created_at")
    .order("created_at", { ascending: false });
  if (pErr) throw pErr;

  const { data: details, error: dErr } = await admin
    .from("employee_details")
    .select("party_id, employment_state, rate_per_km, assigned_vehicle_id, date_of_joining, date_of_leaving");
  if (dErr) throw dErr;
  const detailByParty = new Map((details ?? []).map((d) => [d.party_id as string, d]));

  const { data: accounts } = await admin
    .from("user_accounts")
    .select("party_id, login_email, is_locked, status");
  const accountByParty = new Map((accounts ?? []).map((a) => [a.party_id as string, a]));

  // "admin" is no longer a role. Someone who has been granted the editing
  // keys is what the old screen called an admin; everyone else is staff.
  const { data: grants } = await admin
    .from("party_permissions")
    .select("party_id, permissions(key)")
    .eq("status", "approved");
  const keysByParty = new Map<string, string[]>();
  for (const g of (grants ?? []) as Array<{ party_id: string; permissions: { key: string } | null }>) {
    if (!g.permissions?.key) continue;
    const list = keysByParty.get(g.party_id) ?? [];
    list.push(g.permissions.key);
    keysByParty.set(g.party_id, list);
  }

  const nameById = new Map<string, { name: string; mobile: string | null }>();
  for (const p of parties ?? []) {
    nameById.set(p.id as string, {
      name: p.display_name as string,
      mobile: (p.primary_mobile as string) ?? null,
    });
  }

  const employees = (parties ?? [])
    .filter((p) => staffIds.includes(p.id as string))
    .map((p) => {
      const d = detailByParty.get(p.id as string);
      const roles = rolesByParty.get(p.id as string) ?? [];
      const keys = keysByParty.get(p.id as string) ?? [];
      const role = roles.includes("owner")
        ? "owner"
        : (keys.includes("km_tracker.edit") || keys.includes("employee_master.edit") ? "admin" : "employee");
      const account = accountByParty.get(p.id as string);
      return {
        id: p.id,
        party_id: p.id,
        name: p.display_name,                     // legacy alias
        display_name: p.display_name,
        party_number: p.party_number,
        mobile_number: p.primary_mobile,          // legacy alias
        primary_mobile: p.primary_mobile,
        email: account?.login_email ?? p.primary_email ?? null,
        role,                                     // worked out, not stored
        roles,
        status: d?.employment_state ?? "active",  // legacy alias
        employment_state: d?.employment_state ?? null,
        rate_per_km: d?.rate_per_km ?? null,
        assigned_vehicle_id: d?.assigned_vehicle_id ?? null,
        date_of_joining: d?.date_of_joining ?? null,
        date_of_leaving: d?.date_of_leaving ?? null,
        party_status: p.status,
      };
    });

  return { employees, nameById };
}

// ============================================================
//  the actions
// ============================================================

async function getDashboard(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "km_tracker.view");
  const admin = me.admin;

  // An optional filter. The screen may send either vocabulary --
  // 'calculated' and 'submitted' both mean the same thing here.
  let wanted: string | null = null;
  if (body.status !== undefined && body.status !== null && body.status !== "") {
    wanted = toNewStatus(body.status);
    if (!wanted) throw new AuthError("That is not a status we know.", 400);
  }

  let entriesQuery = admin
    .from("daily_entries")
    .select("*")
    .order("entry_date", { ascending: false })
    .limit(500);
  if (wanted) entriesQuery = entriesQuery.eq("status", wanted);

  const { data: rawEntries, error: entriesErr } = await entriesQuery;
  if (entriesErr) throw entriesErr;

  const { data: vehicles, error: vehErr } = await admin
    .from("vehicles")
    .select("*")
    .order("created_at", { ascending: false });
  if (vehErr) throw vehErr;
  const vehicleNames = new Map((vehicles ?? []).map((v) => [v.id as string, v.vehicle_name as string]));

  const { employees, nameById } = await loadPeople(admin);

  const photos = await signedPhotoUrls(admin, (rawEntries ?? []).map((e) => e.id as string));
  const entries = (rawEntries ?? []).map((e) => shapeEntry(e, nameById, vehicleNames, photos));

  const { data: settings, error: setErr } = await admin
    .from("app_settings").select("*").eq("id", 1).single();
  if (setErr) throw setErr;

  // payment_batches keeps no totals of its own -- the entries are the
  // record. Add them up here so the screen has what it used to print.
  const { data: batches, error: pbErr } = await admin
    .from("payment_batches")
    .select("*")
    .order("created_at", { ascending: false });
  if (pbErr) throw pbErr;

  const { data: paidEntries } = await admin
    .from("daily_entries")
    .select("payment_batch_id, km_travelled, cost")
    .not("payment_batch_id", "is", null);

  const totals = new Map<string, { km: number; cost: number; count: number }>();
  for (const e of paidEntries ?? []) {
    const key = e.payment_batch_id as string;
    const t = totals.get(key) ?? { km: 0, cost: 0, count: 0 };
    t.km += Number(e.km_travelled ?? 0);
    t.cost += Number(e.cost ?? 0);
    t.count += 1;
    totals.set(key, t);
  }

  const paymentBatches = (batches ?? []).map((b) => {
    const t = totals.get(b.id as string) ?? { km: 0, cost: 0, count: 0 };
    const person = nameById.get(b.party_id as string);
    const from = String(b.period_from);
    return {
      ...b,
      legacy_status: legacyStatus(b.status as string),
      employee_id: b.party_id,                            // legacy alias
      employees: person ? { name: person.name } : null,
      parties: person ? { display_name: person.name } : null,
      period_year: Number(from.slice(0, 4)),              // legacy alias
      period_month: Number(from.slice(5, 7)),             // legacy alias
      total_km: Number(t.km.toFixed(2)),
      total_cost: Number(t.cost.toFixed(2)),
      entry_count: t.count,
      paid_at: b.paid_on,                                 // legacy alias
    };
  });

  const shapedVehicles = (vehicles ?? []).map((v) => ({
    ...v,
    owner_employee_id: v.owner_party_id,                  // legacy alias
    is_active: v.status === "approved",                   // legacy alias
  }));

  return json({
    success: true,
    entries,
    employees,
    vehicles: shapedVehicles,
    settings,
    paymentBatches,
  }, 200);
}

async function getSlip(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "km_tracker.view");
  const admin = me.admin;

  const batchId = uuidArg(body.batch_id);
  if (!batchId) throw new AuthError("Missing batch_id", 400);

  const { data: batch, error: batchErr } = await admin
    .from("payment_batches").select("*").eq("id", batchId).maybeSingle();
  if (batchErr) throw batchErr;
  if (!batch) throw new AuthError("That payment slip was not found.", 404);

  const { data: party } = await admin
    .from("parties")
    .select("display_name, primary_mobile, party_number")
    .eq("id", batch.party_id)
    .maybeSingle();

  const { data: rawEntries, error: entriesErr } = await admin
    .from("daily_entries")
    .select("*")
    .eq("payment_batch_id", batchId)
    .order("entry_date", { ascending: true });
  if (entriesErr) throw entriesErr;

  const vehicleIds = [...new Set((rawEntries ?? []).map((e) => e.vehicle_id as string))];
  const vehicleNames = new Map<string, string>();
  if (vehicleIds.length) {
    const { data: vs } = await admin.from("vehicles").select("id, vehicle_name").in("id", vehicleIds);
    for (const v of vs ?? []) vehicleNames.set(v.id as string, v.vehicle_name as string);
  }

  const people = new Map<string, { name: string; mobile: string | null }>();
  if (party) {
    people.set(batch.party_id as string, {
      name: party.display_name as string,
      mobile: (party.primary_mobile as string) ?? null,
    });
  }

  const photos = await signedPhotoUrls(admin, (rawEntries ?? []).map((e) => e.id as string));
  const entries = (rawEntries ?? []).map((e) => shapeEntry(e, people, vehicleNames, photos));

  const totalKm = entries.reduce((s, e) => s + Number(e.km_travelled ?? 0), 0);
  const totalCost = entries.reduce((s, e) => s + Number(e.cost ?? 0), 0);
  const from = String(batch.period_from);

  return json({
    success: true,
    batch: {
      ...batch,
      legacy_status: legacyStatus(batch.status as string),
      employee_id: batch.party_id,
      employees: party ? { name: party.display_name, mobile_number: party.primary_mobile } : null,
      parties: party ?? null,
      period_year: Number(from.slice(0, 4)),
      period_month: Number(from.slice(5, 7)),
      total_km: Number(totalKm.toFixed(2)),
      total_cost: Number(totalCost.toFixed(2)),
      paid_at: batch.paid_on,
    },
    entries,
  }, 200);
}

async function decideEntry(me: Caller, body: Record<string, unknown>, approve: boolean) {
  requirePermission(me, "km_tracker.approve");
  const admin = me.admin;

  const entryId = uuidArg(body.entry_id);
  if (!entryId) throw new AuthError("Missing entry_id", 400);

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!approve && !reason) {
    throw new AuthError("A reason is required to reject an entry.", 400);
  }

  const { data: entry, error: fetchErr } = await admin
    .from("daily_entries").select("*").eq("id", entryId).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!entry) throw new AuthError("Entry not found", 404);

  // Only a costed entry can be decided on. 'submitted' is what the old
  // system called 'calculated'.
  if (entry.status !== "submitted") {
    throw new AuthError(
      `Cannot ${approve ? "approve" : "reject"} an entry that is '${legacyStatus(entry.status as string)}'.`,
      400,
    );
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = approve
    ? { status: "approved" }
    : { status: "cancelled", rejection_reason: reason };

  // There is one "who decided" column on the row. It holds the person who
  // approved OR rejected; the status and the reason say which happened.
  patch.approved_by = me.partyId;
  patch.approved_on = nowIso;

  if (approve) {
    // The money is worked out again here, from the readings on file.
    const rate = await rateFor(admin, entry.vehicle_id as string, entry.party_id as string);
    const figures = recompute(entry, rate);
    if (!figures) {
      throw new AuthError("This entry has no evening reading yet, so there is nothing to approve.", 400);
    }
    Object.assign(patch, figures);
  }

  const { data: updated, error: updErr } = await admin
    .from("daily_entries").update(patch).eq("id", entryId).select().single();
  if (updErr) throw updErr;

  return json({
    success: true,
    entry: { ...updated, legacy_status: legacyStatus(updated.status as string), km_traveled: updated.km_travelled, employee_id: updated.party_id },
  }, 200);
}

async function assignVehicle(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "km_tracker.edit");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);
  const vehicleId = uuidArg(body.vehicle_id);
  if (!partyId || !vehicleId) throw new AuthError("Missing employee or vehicle.", 400);

  const { data: vehicle, error: vehErr } = await admin
    .from("vehicles")
    .select("id, ownership_type, owner_party_id, status, vehicle_name")
    .eq("id", vehicleId)
    .maybeSingle();
  if (vehErr) throw vehErr;
  if (!vehicle) throw new AuthError("Vehicle not found", 404);
  if (vehicle.status !== "approved") {
    throw new AuthError("That vehicle is retired and cannot be assigned.", 400);
  }
  if (vehicle.ownership_type !== "employee" || vehicle.owner_party_id !== partyId) {
    throw new AuthError("This vehicle is not registered as owned by this employee", 400);
  }

  const { data: updated, error: updErr } = await admin
    .from("employee_details")
    .update({ assigned_vehicle_id: vehicleId })
    .eq("party_id", partyId)
    .select("party_id, assigned_vehicle_id")
    .maybeSingle();
  if (updErr) throw updErr;
  if (!updated) throw new AuthError("That person has no employment record.", 404);

  const { data: party } = await admin
    .from("parties").select("display_name").eq("id", partyId).maybeSingle();

  return json({
    success: true,
    employee: {
      id: partyId,
      party_id: partyId,
      name: party?.display_name ?? null,
      display_name: party?.display_name ?? null,
      assigned_vehicle_id: updated.assigned_vehicle_id,
    },
  }, 200);
}

async function addVehicle(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "km_tracker.edit");
  const admin = me.admin;

  const vehicleName = typeof body.vehicle_name === "string" ? body.vehicle_name.trim() : "";
  const ownershipType = typeof body.ownership_type === "string" ? body.ownership_type : "";

  if (!vehicleName || !ownershipType) {
    throw new AuthError("Vehicle name and ownership type are required", 400);
  }
  if (!["company", "employee"].includes(ownershipType)) {
    throw new AuthError("Invalid ownership type", 400);
  }

  // Every vehicle now needs its registration number. If the screen has not
  // sent one yet, take it out of the name -- "Bike - PB10AB1234".
  let vehicleNumber = typeof body.vehicle_number === "string" ? body.vehicle_number.trim().toUpperCase() : "";
  if (!vehicleNumber) {
    const found = vehicleName.toUpperCase().replace(/[^A-Z0-9]/g, "")
      .match(/[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}/);
    vehicleNumber = found ? found[0] : "";
  }
  if (!vehicleNumber) {
    throw new AuthError("The vehicle registration number is required.", 400);
  }

  const ratePerKm = ownershipType === "company" ? Number(body.rate_per_km) : null;
  if (ownershipType === "company" && (!isFinite(ratePerKm as number) || (ratePerKm as number) <= 0)) {
    throw new AuthError("Rate per km is required for company-owned vehicles", 400);
  }

  const ownerPartyId = ownershipType === "employee"
    ? uuidArg(body.owner_party_id, body.owner_employee_id)
    : null;
  if (ownershipType === "employee" && !ownerPartyId) {
    throw new AuthError("Owner employee is required for employee-owned vehicles", 400);
  }

  const { data: existing } = await admin
    .from("vehicles").select("id, status").eq("vehicle_number", vehicleNumber).maybeSingle();
  if (existing) {
    throw new AuthError(`Vehicle ${vehicleNumber} is already on the list.`, 409);
  }

  const { data: newVeh, error: insertErr } = await admin
    .from("vehicles")
    .insert({
      vehicle_number: vehicleNumber,
      vehicle_name: vehicleName,
      ownership_type: ownershipType,
      rate_per_km: ratePerKm,
      owner_party_id: ownerPartyId,
      make_model: typeof body.make_model === "string" ? body.make_model : null,
      status: "approved",
      created_by: me.partyId,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;

  return json({
    success: true,
    vehicle: { ...newVeh, owner_employee_id: newVeh.owner_party_id, is_active: newVeh.status === "approved" },
  }, 200);
}

async function markPaid(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "km_tracker.edit");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Missing employee.", 400);

  // The screen sends a month and a year; the batch stores real dates.
  let periodFrom: string;
  let periodTo: string;
  if (typeof body.period_from === "string" && typeof body.period_to === "string") {
    periodFrom = body.period_from;
    periodTo = body.period_to;
  } else {
    const month = Number(body.period_month);
    const year = Number(body.period_year);
    if (!month || !year || month < 1 || month > 12) {
      throw new AuthError("Missing period_month or period_year", 400);
    }
    periodFrom = `${year}-${String(month).padStart(2, "0")}-01`;
    periodTo = lastDayOfMonth(year, month);
  }
  if (periodTo < periodFrom) throw new AuthError("That period runs backwards.", 400);

  const { data: approvedEntries, error: entriesErr } = await admin
    .from("daily_entries")
    .select("*")
    .eq("party_id", partyId)
    .eq("status", "approved")
    .is("payment_batch_id", null)
    .gte("entry_date", periodFrom)
    .lte("entry_date", periodTo);
  if (entriesErr) throw entriesErr;

  if (!approvedEntries || approvedEntries.length === 0) {
    throw new AuthError("No approved entries found for this employee in this period", 400);
  }

  // Add it up from the rows, never from the request.
  const totalKm = approvedEntries.reduce((s, e) => s + Number(e.km_travelled ?? 0), 0);
  const totalCost = approvedEntries.reduce((s, e) => s + Number(e.cost ?? 0), 0);

  const { data: docNumber, error: numErr } = await admin.rpc("next_human_number", {
    p_series_key: "payment_batch",
  });
  if (numErr) throw numErr;

  const { data: batch, error: batchErr } = await admin
    .from("payment_batches")
    .insert({
      document_number: docNumber,
      party_id: partyId,
      period_from: periodFrom,
      period_to: periodTo,
      paid_on: today(),
      paid_by: me.partyId,
      status: "completed",
      remarks: typeof body.remarks === "string" ? body.remarks : null,
      created_by: me.partyId,
    })
    .select()
    .single();
  if (batchErr) throw batchErr;

  const entryIds = approvedEntries.map((e) => e.id as string);
  const { data: paidRows, error: updErr } = await admin
    .from("daily_entries")
    .update({ status: "completed", payment_batch_id: batch.id })
    .in("id", entryIds)
    .select();
  if (updErr) throw updErr;

  const { data: party } = await admin
    .from("parties").select("display_name, primary_mobile").eq("id", partyId).maybeSingle();

  return json({
    success: true,
    batch: {
      ...batch,
      legacy_status: legacyStatus(batch.status as string),
      employee_id: batch.party_id,
      employees: party ? { name: party.display_name, mobile_number: party.primary_mobile } : null,
      period_year: Number(periodFrom.slice(0, 4)),
      period_month: Number(periodFrom.slice(5, 7)),
      total_km: Number(totalKm.toFixed(2)),
      total_cost: Number(totalCost.toFixed(2)),
      entry_count: entryIds.length,
      paid_at: batch.paid_on,
    },
    entries: (paidRows ?? []).map((e) => ({
      ...e,
      legacy_status: legacyStatus(e.status as string),
      employee_id: e.party_id,
      km_traveled: e.km_travelled,
    })),
  }, 200);
}

async function updateSettings(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "km_tracker.edit");

  const maxDailyKm = Number(body.max_daily_km);
  if (!isFinite(maxDailyKm) || maxDailyKm <= 0) {
    throw new AuthError("Invalid max daily km value", 400);
  }

  const { data: updated, error } = await me.admin
    .from("app_settings")
    .update({ max_daily_km: maxDailyKm })
    .eq("id", 1)
    .select()
    .single();
  if (error) throw error;

  return json({ success: true, settings: updated }, 200);
}

// ---------- an employee's state ----------
// Nothing is deleted. Removal is suspension, then 'left'.
async function changeEmploymentState(
  me: Caller,
  body: Record<string, unknown>,
  newState: "suspended" | "left" | "active",
) {
  requirePermission(me, "employee_master.edit");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Missing employee.", 400);
  if (partyId === me.partyId) {
    throw new AuthError("You cannot change your own employment state.", 400);
  }

  const { data: targetRoles } = await admin
    .from("party_roles").select("role").eq("party_id", partyId).eq("status", "approved");
  if ((targetRoles ?? []).some((r) => r.role === "owner")) {
    throw new AuthError("The owner's record cannot be changed here.", 400);
  }

  const patch: Record<string, unknown> = { employment_state: newState };
  if (newState === "left") {
    patch.date_of_leaving = today();
    if (typeof body.reason === "string" && body.reason.trim()) {
      patch.leaving_reason = body.reason.trim();
    }
    patch.assigned_vehicle_id = null;   // the vehicle goes back
  }

  const { data: updated, error } = await admin
    .from("employee_details")
    .update(patch)
    .eq("party_id", partyId)
    .select("party_id, employment_state, date_of_leaving, assigned_vehicle_id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw new AuthError("That person has no employment record.", 404);

  // Someone who has left cannot sign in again.
  if (newState === "left") {
    await admin.from("user_accounts").update({ is_locked: true }).eq("party_id", partyId);
  }

  const { data: party } = await admin
    .from("parties").select("display_name").eq("id", partyId).maybeSingle();

  return json({
    success: true,
    employee: {
      id: partyId,
      party_id: partyId,
      name: party?.display_name ?? null,
      display_name: party?.display_name ?? null,
      status: updated.employment_state,             // legacy alias
      employment_state: updated.employment_state,
      date_of_leaving: updated.date_of_leaving,
      assigned_vehicle_id: updated.assigned_vehicle_id,
    },
  }, 200);
}

// ============================================================

Deno.serve((req) => handle(req, async () => {
  // Who is calling comes from the token and nothing else. Whatever the
  // body claims about identity is read past and thrown away.
  const me = await authenticate(req);
  requireActiveEmployee(me);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    throw new AuthError("The request could not be read.", 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!action) throw new AuthError("Missing action", 400);

  switch (action) {
    case "get_dashboard":     return await getDashboard(me, body);
    case "get_slip":          return await getSlip(me, body);
    case "approve_entry":     return await decideEntry(me, body, true);
    case "reject_entry":      return await decideEntry(me, body, false);
    case "assign_vehicle":    return await assignVehicle(me, body);
    case "add_vehicle":       return await addVehicle(me, body);
    case "mark_paid":         return await markPaid(me, body);
    case "update_settings":   return await updateSettings(me, body);
    case "initiate_removal":  return await changeEmploymentState(me, body, "suspended");
    case "approve_removal":   return await changeEmploymentState(me, body, "left");
    case "resume_employee":   return await changeEmploymentState(me, body, "active");
    default:
      throw new AuthError("Unknown action", 400);
  }
}));
