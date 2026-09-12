// ============================================================
// hr-actions — Employee Master and the HR dropdown screens.
//
// What changed from Tokyo, and why:
//
//  1. IDENTITY. The old version read `requester_id` out of the request
//     body and believed it. Anyone who knew an admin's UUID had admin
//     powers. There is no `requester_id` in this file. The caller comes
//     only from `authenticate(req)`, which reads the signed token.
//     Any identity field arriving in the body is read past and dropped.
//
//  2. PERMISSION. `role in ('admin','owner')` is gone. Each action asks
//     for the one permission key it needs. Owner passes everything --
//     the shared helper handles that.
//
//  3. SHAPE. One flat `employees` table of 75 columns has become
//     `parties` (who they are) + `employee_details` (their employment)
//     + `party_roles` (what they are) + the shared child tables
//     (`party_addresses`, `party_contacts`, `party_bank_accounts`,
//     `party_family_members`, `party_education`,
//     `party_work_experience`, `employee_assets`). Pay is no longer a
//     column at all -- it is `salary_records`, a dated history.
//     The screen has not been rewritten yet, so every reply carries the
//     old flat field names it reads alongside the real new ones. When
//     the screen is rewritten the legacy aliases come out and nothing
//     else changes.
//
//  4. AADHAAR. Only the last four digits are kept. If the screen sends
//     twelve, eight are thrown away before anything is written, and a
//     full Aadhaar number is never returned to anybody.
//
//  5. PAY IS A HISTORY. Adding a salary INSERTs a new dated row. An
//     earlier row is never overwritten, so last year's figure is still
//     there to look at. Today's figure is `public.current_salary()`.
//
//  6. NOTHING IS DELETED. Retiring a dropdown value is
//     `status = 'cancelled'`. Removing a person is
//     `employment_state = 'left'`. Replacing a file keeps the old one.
//
//  7. PINS AND LOGIN REQUESTS ARE GONE. `erp_login_requests`,
//     `employees.pin`, `password_hash`, `employee_sessions` and
//     `password_reset_tokens` were all retired with Tokyo. A login is
//     now a real Supabase Auth user, made by `create_employee_login`,
//     with a random password nobody ever sees; the person gets in
//     through the "forgotten password" link.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  authenticate, handle, json, requireActiveEmployee, requirePermission,
  AuthError, checkFileBytes, SCAN_ENGINE, SCAN_NOTE,
  SUPABASE_URL, type Caller,
} from "../_shared/auth.ts";

// ---------- small, dull helpers ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid the caller sent. Only ever names a *row*, never a person's rights. */
function uuidArg(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && UUID_RE.test(c)) return c;
  }
  return null;
}

function str(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c.trim();
    if (typeof c === "number" && isFinite(c)) return String(c);
  }
  return null;
}

function bool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1" || v === "yes";
}

function num(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (c === null || c === undefined || c === "") continue;
    const n = Number(c);
    if (isFinite(n)) return n;
  }
  return null;
}

/** A date the database will accept, or null. Never a half-typed one. */
function dateArg(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t) && !isNaN(Date.parse(t))) return t;
  }
  return null;
}

function digitsOnly(v: unknown): string {
  return typeof v === "string" || typeof v === "number"
    ? String(v).replace(/\D/g, "")
    : "";
}

function todayInIndia(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().split("T")[0];
}

const MOBILE_RE = /^[6-9][0-9]{9}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PINCODE_RE = /^[1-9][0-9]{5}$/;

/** A mobile number the database's own CHECK will accept, or null. */
function mobileArg(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const d = digitsOnly(c);
    const ten = d.length > 10 ? d.slice(-10) : d;
    if (MOBILE_RE.test(ten)) return ten;
  }
  return null;
}

function panArg(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return PAN_RE.test(s) ? s : null;
}

function ifscArg(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return IFSC_RE.test(s) ? s : null;
}

function pincodeArg(v: unknown): string | null {
  const d = digitsOnly(v);
  return PINCODE_RE.test(d) ? d : null;
}

/**
 * The ONLY thing we are allowed to keep of an Aadhaar number.
 * Twelve digits in, four digits out; the other eight never touch a disk.
 */
function aadhaarLast4(v: unknown): string | null {
  const d = digitsOnly(v);
  if (d.length < 4) return null;
  return d.slice(-4);
}

/** How an Aadhaar is shown back to a screen. Never the real number. */
function maskedAadhaar(last4: string | null): string | null {
  return last4 ? `XXXX XXXX ${last4}` : null;
}

// ---------- the fixed vocabularies ----------
// These are the words the database's own CHECK constraints allow. The
// screen still sends the older, prettier spellings ("Monthly", "S/o"),
// so each list has a small table of the spellings we accept. Anything
// outside both is refused by name, with the allowed words spelled out --
// a raw Postgres constraint error is never shown to anybody.

const WAGE_TYPES = ["monthly", "daily", "hourly", "piece_rate"];
const PAYMENT_METHODS = ["bank", "cash", "cheque", "upi"];
const MARITAL_STATUSES = ["single", "married", "widowed", "divorced", "other"];
const GUARDIAN_RELATIONS = ["father", "husband", "mother", "guardian", "other"];
const GENDERS = ["male", "female", "other"];

// "S/o Ram" means Ram is his father; "W/o Ram" means Ram is her husband.
const GUARDIAN_ALIASES: Record<string, string> = {
  "s/o": "father", "d/o": "father", "w/o": "husband",
  "son_of": "father", "daughter_of": "father", "wife_of": "husband",
  "m/o": "mother", "c/o": "guardian",
};

/**
 * One value from a fixed list. Accepts the screen's spelling, returns the
 * database's. Refuses anything else with a sentence a person can act on.
 */
function enumArg(
  label: string,
  raw: unknown,
  allowed: string[],
  aliases: Record<string, string> = {},
): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const shown = String(raw).trim();
  if (shown === "") return null;
  const key = shown.toLowerCase().replace(/[\s-]+/g, "_");
  if (aliases[key]) return aliases[key];
  if (allowed.includes(key)) return key;
  throw new AuthError(
    `"${shown}" is not a ${label} this system knows. It has to be one of: ${allowed.join(", ")}.`,
    400,
  );
}

/** The database word, spelled the way the screen's dropdowns spell it. */
function prettyWord(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  return v.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** guardian_relation, put back into the S/o - D/o - W/o the form shows. */
function legacyGuardianRelation(relation: unknown, gender: unknown): string | null {
  if (typeof relation !== "string" || relation === "") return null;
  if (relation === "husband") return "W/o";
  if (relation === "mother") return "M/o";
  if (relation === "guardian" || relation === "other") return "C/o";
  // 'father' covers both S/o and D/o; only the person's own gender says which.
  return gender === "female" ? "D/o" : "S/o";
}

// ---------- the lookup lists ----------
// `is_active` is gone. 'approved' means in use, 'cancelled' means retired.
// Nothing is ever deleted from these tables.

const DROPDOWN_TABLES: Record<string, { table: string; extra: string[] }> = {
  branches:            { table: "branches",            extra: [] },
  departments:         { table: "departments",         extra: [] },
  designations:        { table: "designations",        extra: [] },
  employee_categories: { table: "employee_categories", extra: [] },
  relationships:       { table: "relationships",       extra: [] },
  holiday_types:       { table: "holiday_types",       extra: [] },
  states:              { table: "states",              extra: [] },
  cities:              { table: "cities",              extra: ["state_id"] },
};

// ---------- documents ----------

const DOC_BUCKET = "documents";
const SIGNED_URL_SECONDS = 600;      // short-lived on purpose
const MAX_UPLOAD_BYTES = 25 * 1048576;

/** The screen's slot names, translated to the categories the ERP files by. */
const DOC_CATEGORY_FROM_SLOT: Record<string, string> = {
  aadhar: "aadhaar",
  aadhaar: "aadhaar",
  aadhar_card: "aadhaar",
  aadhaar_card: "aadhaar",
  pan: "pan",
  pan_card: "pan",
  bank: "bank_proof",
  bank_proof: "bank_proof",
  cancelled_cheque: "bank_proof",
  photo: "photo",
  qualification: "qualification",
  education: "qualification",
  education_certificate: "qualification",
};
const DOC_CATEGORIES = [
  "aadhaar", "pan", "bank_proof", "photo", "qualification", "other",
];

function docCategoryForSlot(slot: string): string {
  return DOC_CATEGORY_FROM_SLOT[slot] ?? (DOC_CATEGORIES.includes(slot) ? slot : "other");
}

/**
 * A client that acts AS THE CALLER rather than as the service role.
 * Needed only for `public.replace_attachment`, which decides for itself
 * whether the signed-in person may replace that file. The token is the
 * same one `authenticate` already proved; nothing new is trusted here.
 */
function callerScopedClient(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? token;
  return createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Signed links for a set of attachments. A file that has not passed the
 * byte check gets NO link at all -- not a broken one, none.
 */
async function signAttachments(
  admin: Caller["admin"],
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const clean = rows.filter((r) => r.scan_status === "clean" && r.is_current !== false);
  const paths = [...new Set(clean.map((r) => r.storage_path as string))];
  const urlByPath = new Map<string, string>();

  if (paths.length > 0) {
    const { data: signed } = await admin.storage
      .from(DOC_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const s of signed ?? []) {
      if (s.signedUrl && !s.error) urlByPath.set(s.path as string, s.signedUrl);
    }
  }

  return rows.map((r) => ({
    ...r,
    // legacy names the Employee Master screen still reads
    slot: (r.title as string) || (r.doc_category as string),
    document_name: (r.title as string) || (r.doc_category as string),
    file_url: r.storage_path,
    signed_url: r.scan_status === "clean"
      ? (urlByPath.get(r.storage_path as string) ?? null)
      : null,
  }));
}

// ============================================================
//  reading people out of the new shape
// ============================================================

interface LookupMaps {
  branches: Map<string, string>;
  departments: Map<string, string>;
  designations: Map<string, string>;
  employee_categories: Map<string, string>;
  relationships: Map<string, string>;
  states: Map<string, string>;
  cities: Map<string, string>;
}

async function loadLookups(admin: Caller["admin"]): Promise<LookupMaps> {
  const names = ["branches", "departments", "designations", "employee_categories",
    "relationships", "states", "cities"] as const;
  const results = await Promise.all(
    names.map((t) => admin.from(t).select("id, name")),
  );
  const out = {} as LookupMaps;
  names.forEach((t, i) => {
    const m = new Map<string, string>();
    for (const row of results[i].data ?? []) m.set(row.id as string, row.name as string);
    (out as Record<string, Map<string, string>>)[t] = m;
  });
  return out;
}

/** One person, dressed in both vocabularies. */
function shapeEmployeeRow(
  party: Record<string, unknown>,
  detail: Record<string, unknown> | undefined,
  roles: string[],
  account: Record<string, unknown> | undefined,
  look: LookupMaps,
  photoUrl: string | null,
) {
  const d = detail ?? {};
  return {
    id: party.id,
    party_id: party.id,

    // ---- legacy flat names the screen reads ----
    employee_code: party.party_number,
    name: party.display_name,
    mobile_number: party.primary_mobile,
    email: (account?.login_email as string) ?? (party.primary_email as string) ?? null,
    status: (d.employment_state as string) ?? "active",
    role: roles.includes("owner") ? "owner" : "employee",
    photo_url: photoUrl,
    photo_signed_url: photoUrl,
    erp_login_enabled: Boolean(account) && account?.is_locked !== true,
    login_mode: null,
    vehicle_km_applicable: d.assigned_vehicle_id !== null && d.assigned_vehicle_id !== undefined
      ? true
      : d.rate_per_km !== null && d.rate_per_km !== undefined,

    // ---- the real new names ----
    display_name: party.display_name,
    party_number: party.party_number,
    primary_mobile: party.primary_mobile,
    primary_email: party.primary_email,
    party_status: party.status,
    roles,
    employment_state: (d.employment_state as string) ?? null,

    branch_id: d.branch_id ?? null,
    department_id: d.department_id ?? null,
    designation_id: d.designation_id ?? null,
    employee_category_id: d.employee_category_id ?? null,
    reports_to_party_id: d.reports_to_party_id ?? null,
    date_of_joining: d.date_of_joining ?? null,
    date_of_confirmation: d.date_of_confirmation ?? null,
    date_of_leaving: d.date_of_leaving ?? null,
    leaving_reason: d.leaving_reason ?? null,
    rate_per_km: d.rate_per_km ?? null,
    assigned_vehicle_id: d.assigned_vehicle_id ?? null,
    work_location: d.work_location ?? null,

    // nested names the old `select` produced
    branches: { name: look.branches.get(d.branch_id as string) ?? null },
    departments: { name: look.departments.get(d.department_id as string) ?? null },
    designations: { name: look.designations.get(d.designation_id as string) ?? null },
    employee_categories: { name: look.employee_categories.get(d.employee_category_id as string) ?? null },
  };
}

// ============================================================
//  dropdown / master maintenance
// ============================================================

async function getDropdowns(me: Caller) {
  requirePermission(me, "employee_master.view");
  const admin = me.admin;

  const keys = Object.keys(DROPDOWN_TABLES);
  const results = await Promise.all(
    keys.map((k) => admin.from(DROPDOWN_TABLES[k].table).select("*").order("name")),
  );

  const dropdowns: Record<string, unknown[]> = {};
  keys.forEach((k, i) => {
    if (results[i].error) throw results[i].error;
    dropdowns[k] = (results[i].data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      is_active: row.status === "approved",   // legacy alias
    }));
  });

  // The asset_types list was dropped -- an asset type is now free text.
  dropdowns.asset_types = [];

  return json({ success: true, dropdowns }, 200);
}

function dropdownTable(body: Record<string, unknown>): { key: string; table: string } {
  const key = str(body.table, body.list) ?? "";
  if (key === "asset_types") {
    throw new AuthError(
      "Asset types are no longer a fixed list. Type the asset in freely when you record it.",
      400,
    );
  }
  const entry = DROPDOWN_TABLES[key];
  if (!entry) throw new AuthError("That is not a list we keep.", 400);
  return { key, table: entry.table };
}

async function addDropdownItem(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "employee_master.edit");
  const { key, table } = dropdownTable(body);

  const fields = (body.fields ?? {}) as Record<string, unknown>;
  const name = str(fields.name, body.name, body.new_name);
  if (!name) throw new AuthError("A name is required.", 400);

  const row: Record<string, unknown> = {
    name,
    status: "approved",
    created_by: me.partyId,
  };

  if (key === "cities") {
    const stateId = uuidArg(fields.state_id, body.state_id);
    if (!stateId) throw new AuthError("A city needs a state.", 400);
    row.state_id = stateId;
  }

  const { data, error } = await me.admin.from(table).insert(row).select().single();
  if (error) {
    if (error.code === "23505") {
      throw new AuthError(`"${name}" is already on that list.`, 409);
    }
    throw error;
  }
  return json({ success: true, item: { ...data, is_active: true } }, 200);
}

async function renameDropdownItem(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "employee_master.edit");
  const { table } = dropdownTable(body);

  const id = uuidArg(body.id, body.item_id);
  const newName = str(body.new_name, body.name);
  if (!id) throw new AuthError("Which item should be renamed?", 400);
  if (!newName) throw new AuthError("A name is required.", 400);

  const { data, error } = await me.admin
    .from(table).update({ name: newName }).eq("id", id).select().maybeSingle();
  if (error) {
    if (error.code === "23505") throw new AuthError(`"${newName}" is already on that list.`, 409);
    throw error;
  }
  if (!data) throw new AuthError("That item was not found.", 404);
  return json({ success: true, item: { ...data, is_active: data.status === "approved" } }, 200);
}

/**
 * Retire, or bring back. Never delete -- a value that is on an old
 * employee's record has to stay readable forever, so it is only marked
 * 'cancelled' and disappears from the pickers.
 */
async function setDropdownStatus(me: Caller, body: Record<string, unknown>, active: boolean | null) {
  requirePermission(me, "employee_master.edit");
  const { table } = dropdownTable(body);

  const id = uuidArg(body.id, body.item_id);
  if (!id) throw new AuthError("Which item?", 400);

  const wantActive = active === null ? bool(body.is_active) : active;
  const newStatus = wantActive ? "approved" : "cancelled";

  const { data, error } = await me.admin
    .from(table).update({ status: newStatus }).eq("id", id).select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError("That item was not found.", 404);

  return json({
    success: true,
    item: { ...data, is_active: data.status === "approved" },
    message: wantActive
      ? "Back on the list."
      : "Retired. It no longer appears in the pickers, and the records that already use it are untouched.",
  }, 200);
}

// ============================================================
//  the employee list
// ============================================================

async function getEmployeeList(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "employee_master.view");
  const admin = me.admin;

  const { data: roleRows, error: roleErr } = await admin
    .from("party_roles").select("party_id, role").eq("status", "approved");
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

  if (staffIds.length === 0) return json({ success: true, employees: [] }, 200);

  const { data: parties, error: pErr } = await admin
    .from("parties").select("*").in("id", staffIds)
    .order("created_at", { ascending: false });
  if (pErr) throw pErr;

  const { data: details, error: dErr } = await admin
    .from("employee_details").select("*").in("party_id", staffIds);
  if (dErr) throw dErr;
  const detailByParty = new Map((details ?? []).map((d) => [d.party_id as string, d]));

  const { data: accounts } = await admin
    .from("user_accounts").select("party_id, login_email, is_locked, status")
    .in("party_id", staffIds);
  const accountByParty = new Map((accounts ?? []).map((a) => [a.party_id as string, a]));

  const look = await loadLookups(admin);

  // Photos, one batch of signed links rather than one call each.
  const { data: photoRows } = await admin
    .from("attachments")
    .select("entity_id, storage_path, scan_status, is_current")
    .eq("entity_table", "parties").eq("doc_category", "photo")
    .eq("storage_bucket", DOC_BUCKET)
    .eq("is_current", true).eq("scan_status", "clean")
    .in("entity_id", staffIds);

  const photoPaths = [...new Set((photoRows ?? []).map((p) => p.storage_path as string))];
  const urlByPath = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signed } = await admin.storage
      .from(DOC_BUCKET).createSignedUrls(photoPaths, SIGNED_URL_SECONDS);
    for (const s of signed ?? []) {
      if (s.signedUrl && !s.error) urlByPath.set(s.path as string, s.signedUrl);
    }
  }
  const photoByParty = new Map<string, string>();
  for (const p of photoRows ?? []) {
    const url = urlByPath.get(p.storage_path as string);
    if (url) photoByParty.set(p.entity_id as string, url);
  }

  let employees = (parties ?? []).map((p) => shapeEmployeeRow(
    p,
    detailByParty.get(p.id as string),
    rolesByParty.get(p.id as string) ?? [],
    accountByParty.get(p.id as string),
    look,
    photoByParty.get(p.id as string) ?? null,
  ));

  // An optional search box. Matching happens here so the screen never
  // has to build a query of its own.
  const term = str(body.search, body.q, body.query);
  if (term) {
    const needle = term.toLowerCase();
    employees = employees.filter((e) =>
      [e.name, e.employee_code, e.mobile_number, e.email,
        e.branches.name, e.departments.name, e.designations.name]
        .some((v) => typeof v === "string" && v.toLowerCase().includes(needle))
    );
  }

  const state = str(body.employment_state, body.status);
  if (state && state !== "all") {
    employees = employees.filter((e) => e.employment_state === state);
  }

  return json({ success: true, employees }, 200);
}

// ============================================================
//  one employee, everything about them, in one call
// ============================================================

async function getEmployeeDetail(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "employee_master.view");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id, body.id);
  if (!partyId) throw new AuthError("Which employee?", 400);

  const { data: party, error: pErr } = await admin
    .from("parties").select("*").eq("id", partyId).maybeSingle();
  if (pErr) throw pErr;
  if (!party) throw new AuthError("That employee was not found.", 404);

  const [
    detailRes, rolesRes, accountRes, addressRes, contactRes, bankRes,
    familyRes, eduRes, workRes, assetRes, docRes, salaryRes, currentRes,
  ] = await Promise.all([
    admin.from("employee_details").select("*").eq("party_id", partyId).maybeSingle(),
    admin.from("party_roles").select("*").eq("party_id", partyId),
    admin.from("user_accounts").select("party_id, login_email, is_locked, status, must_change_password, two_step_enabled, last_login_at").eq("party_id", partyId).maybeSingle(),
    admin.from("party_addresses").select("*").eq("party_id", partyId).neq("status", "cancelled"),
    admin.from("party_contacts").select("*").eq("party_id", partyId).neq("status", "cancelled"),
    admin.from("party_bank_accounts").select("*").eq("party_id", partyId).neq("status", "cancelled"),
    admin.from("party_family_members").select("*").eq("party_id", partyId).neq("status", "cancelled"),
    admin.from("party_education").select("*").eq("party_id", partyId).neq("status", "cancelled"),
    admin.from("party_work_experience").select("*").eq("party_id", partyId).neq("status", "cancelled"),
    admin.from("employee_assets").select("*").eq("party_id", partyId).neq("status", "cancelled"),
    admin.from("attachments").select("*").eq("entity_table", "parties").eq("entity_id", partyId).eq("is_current", true),
    admin.from("salary_records").select("*").eq("party_id", partyId).order("effective_from", { ascending: false }),
    admin.rpc("current_salary", { p_party_id: partyId }),
  ]);

  for (const r of [detailRes, rolesRes, addressRes, contactRes, bankRes,
    familyRes, eduRes, workRes, assetRes, docRes, salaryRes]) {
    if (r.error) throw r.error;
  }

  const look = await loadLookups(admin);
  const roles = (rolesRes.data ?? [])
    .filter((r) => r.status === "approved").map((r) => r.role as string);

  const documents = await signAttachments(admin, docRes.data ?? []);
  const photoDoc = documents.find((d) => d.doc_category === "photo");

  const base = shapeEmployeeRow(
    party, detailRes.data ?? undefined, roles, accountRes.data ?? undefined, look,
    (photoDoc?.signed_url as string) ?? null,
  );

  const addresses = addressRes.data ?? [];
  const present = addresses.find((a) => a.address_type === "primary") ?? addresses[0] ?? null;
  const permanent = addresses.find((a) => a.address_type === "permanent") ?? null;
  const bank = (bankRes.data ?? []).find((b) => b.is_primary) ?? (bankRes.data ?? [])[0] ?? null;

  const currentSalary = (currentRes.data as Record<string, unknown> | null) ?? null;
  const family = (familyRes.data ?? []).filter((f) => !f.is_nominee);
  const nominees = (familyRes.data ?? []).filter((f) => f.is_nominee);

  // The flat employee object the Employee Master form still reads.
  const employee = {
    ...base,

    father_husband_name: party.father_name,
    // The form's dropdowns are spelled "Male", "Single", "Monthly". The
    // database keeps the plain lower-case word. Both are handed back so
    // the form opens with the right option already chosen.
    gender: prettyWord(party.gender),
    gender_code: party.gender,
    father_husband_relation: legacyGuardianRelation(party.guardian_relation, party.gender),
    guardian_relation: party.guardian_relation,
    marital_status: prettyWord(party.marital_status),
    marital_status_code: party.marital_status,
    religion: party.religion,
    place_of_birth: party.place_of_birth,
    tel_home: party.landline,                    // legacy alias
    landline: party.landline,
    date_of_birth: party.date_of_birth,
    blood_group: party.blood_group,
    pan_number: party.pan,
    pan: party.pan,
    notes: party.notes,

    // Only the last four digits exist. This is a mask, not a number.
    aadhaar_last4: party.aadhaar_last4,
    aadhar_no: maskedAadhaar(party.aadhaar_last4 as string | null),
    aadhar_number: maskedAadhaar(party.aadhaar_last4 as string | null),

    uan_number: detailRes.data?.uan_number ?? null,
    esi_number: detailRes.data?.esi_number ?? null,
    esi_dispensary: detailRes.data?.esi_dispensary ?? null,
    pf_applicable: detailRes.data?.pf_applicable ?? false,
    pf_number: detailRes.data?.pf_number ?? null,
    esi_applicable: detailRes.data?.esi_applicable ?? false,

    wage_type: prettyWord(detailRes.data?.wage_type),
    wage_type_code: detailRes.data?.wage_type ?? null,
    source_of_employee: detailRes.data?.source_of_employee ?? null,

    emergency_contact_name: detailRes.data?.emergency_contact_name ?? null,
    emergency_contact_mobile: detailRes.data?.emergency_contact_no ?? null,
    emergency_contact_relation: detailRes.data?.emergency_contact_relation ?? null,
    emergency_contact_address: detailRes.data?.emergency_contact_address ?? null,

    driving_license_number: detailRes.data?.driving_license_number ?? null,
    driving_license_category: detailRes.data?.driving_license_category ?? null,
    driving_license_validity: detailRes.data?.driving_license_validity ?? null,

    // Who recommended them. The linked record is the real answer; the
    // name is carried too, because that is what the picker matches on.
    has_ref_employee: Boolean(
      detailRes.data?.referred_by_party_id ?? detailRes.data?.referred_by_name,
    ),
    referred_by_party_id: detailRes.data?.referred_by_party_id ?? null,
    ref_employee_name: detailRes.data?.referred_by_name ?? null,
    referred_by_name: detailRes.data?.referred_by_name ?? null,
    ref_employee_contact: detailRes.data?.referred_by_contact ?? null,
    referred_by_contact: detailRes.data?.referred_by_contact ?? null,

    present_address: present?.line1 ?? null,
    present_city_id: present?.city_id ?? null,
    present_state_id: present?.state_id ?? null,
    present_pincode: present?.pincode ?? null,
    permanent_address: permanent?.line1 ?? null,
    permanent_city_id: permanent?.city_id ?? null,
    permanent_state_id: permanent?.state_id ?? null,
    permanent_pincode: permanent?.pincode ?? null,

    bank_name: bank?.bank_name ?? null,
    bank_account_number: bank?.account_number ?? null,
    bank_ifsc: bank?.ifsc ?? null,
    bank_branch: bank?.branch_name ?? null,
    bank_account_holder_name: bank?.account_holder_name ?? null,
    // What the record says, not what we can guess from a bank row.
    salary_payment_method: detailRes.data?.salary_payment_method
      ?? (bank ? "bank" : "cash"),

    salary_basic: currentSalary?.basic ?? null,
    salary_hra: currentSalary?.hra ?? null,
    salary_da: currentSalary?.da ?? null,
    salary_ta: currentSalary?.ta ?? null,
    salary_other_allowance: currentSalary?.other_allowance ?? null,
  };

  return json({
    success: true,
    employee,
    // the real new shape, beside the flat one
    party,
    employment: detailRes.data ?? null,
    roles,
    account: accountRes.data ?? null,
    addresses,
    contacts: contactRes.data ?? [],
    bank_accounts: bankRes.data ?? [],
    family: family.map((f) => ({
      ...f,
      member_name: f.full_name,                                   // legacy alias
      relationships: { name: look.relationships.get(f.relationship_id as string) ?? null },
    })),
    nominees: nominees.map((n) => ({
      ...n,
      name: n.full_name,                                          // legacy alias
      relation: look.relationships.get(n.relationship_id as string) ?? null,
      share: n.nominee_share_pc,
    })),
    education: (eduRes.data ?? []).map((e) => ({
      ...e,
      institute_name: e.institution,                              // legacy aliases
      board_university: e.board_or_uni,
      passing_year: e.year_of_pass,
      percentage: e.grade,
    })),
    workExperience: (workRes.data ?? []).map((w) => ({
      ...w,
      position: w.designation,                                    // legacy alias
    })),
    work_experience: workRes.data ?? [],
    assets: (assetRes.data ?? []).map((a) => ({
      ...a,
      asset_types: { name: a.asset_type },                        // legacy alias
    })),
    documents,
    current_salary: currentSalary,
    salary_history: salaryRes.data ?? [],
  }, 200);
}

// ============================================================
//  creating and editing a person
// ============================================================

/** Everything in `core` that belongs on the `parties` row. */
function partyPatchFromCore(core: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  const name = str(core.name, core.display_name, core.full_name);
  if (name) patch.display_name = name;

  const mobile = mobileArg(core.mobile_number, core.primary_mobile, core.mobile);
  if (mobile) patch.primary_mobile = mobile;

  const email = str(core.email, core.primary_email);
  if (email) patch.primary_email = email.toLowerCase();

  const dob = dateArg(core.date_of_birth);
  if (dob) patch.date_of_birth = dob;

  const gender = enumArg("gender", core.gender, GENDERS);
  if (gender) patch.gender = gender;

  const father = str(core.father_husband_name, core.father_name);
  if (father) patch.father_name = father;

  // Whether `father_name` is holding a father's name or a husband's.
  const guardian = enumArg(
    "relation", core.guardian_relation ?? core.father_husband_relation,
    GUARDIAN_RELATIONS, GUARDIAN_ALIASES,
  );
  if (guardian) patch.guardian_relation = guardian;

  const marital = enumArg("marital status", core.marital_status, MARITAL_STATUSES);
  if (marital) patch.marital_status = marital;

  const religion = str(core.religion);
  if (religion) patch.religion = religion;

  const placeOfBirth = str(core.place_of_birth);
  if (placeOfBirth) patch.place_of_birth = placeOfBirth;

  // The old screen calls the house phone `tel_home`.
  const landline = str(core.landline, core.tel_home);
  if (landline) patch.landline = landline;

  const blood = str(core.blood_group);
  if (blood) patch.blood_group = blood;

  const pan = panArg(core.pan_number ?? core.pan);
  if (pan) patch.pan = pan;

  // Twelve digits arrive, four are kept, eight are dropped on the floor.
  if (core.aadhar_no !== undefined || core.aadhaar_no !== undefined
    || core.aadhar_number !== undefined || core.aadhaar_number !== undefined) {
    const last4 = aadhaarLast4(core.aadhar_no ?? core.aadhaar_no ?? core.aadhar_number ?? core.aadhaar_number);
    if (last4) patch.aadhaar_last4 = last4;
  }

  const notes = str(core.notes);
  if (notes) patch.notes = notes;

  return patch;
}

/** Everything in `core` that belongs on the `employee_details` row. */
function employmentPatchFromCore(core: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};

  const pairs: Array<[string, unknown]> = [
    ["branch_id", core.branch_id],
    ["department_id", core.department_id],
    ["designation_id", core.designation_id],
    ["employee_category_id", core.employee_category_id],
    ["reports_to_party_id", core.reports_to_party_id],
  ];
  for (const [col, v] of pairs) {
    if (v === null) patch[col] = null;
    else { const id = uuidArg(v); if (id) patch[col] = id; }
  }

  const doj = dateArg(core.date_of_joining);
  if (doj) patch.date_of_joining = doj;
  const doc = dateArg(core.date_of_confirmation);
  if (doc) patch.date_of_confirmation = doc;

  const esi = str(core.esi_number);
  if (esi) patch.esi_number = esi;
  const uan = str(core.uan_number);
  if (uan) patch.uan_number = uan;
  const pfNo = str(core.pf_number);
  if (pfNo) patch.pf_number = pfNo;
  const dispensary = str(core.esi_dispensary);
  if (dispensary) patch.esi_dispensary = dispensary;

  if (core.pf_applicable !== undefined) patch.pf_applicable = bool(core.pf_applicable);
  if (core.esi_applicable !== undefined) patch.esi_applicable = bool(core.esi_applicable);

  // How they are paid, and on what footing.
  const wageType = enumArg("wage type", core.wage_type, WAGE_TYPES);
  if (wageType) patch.wage_type = wageType;
  const payMethod = enumArg(
    "salary payment method", core.salary_payment_method, PAYMENT_METHODS,
  );
  if (payMethod) patch.salary_payment_method = payMethod;

  const work = str(core.work_location);
  if (work) patch.work_location = work;

  const source = str(core.source_of_employee);
  if (source) patch.source_of_employee = source;

  const ecName = str(core.emergency_contact_name);
  if (ecName) patch.emergency_contact_name = ecName;
  const ecNo = mobileArg(core.emergency_contact_mobile, core.emergency_contact_no);
  if (ecNo) patch.emergency_contact_no = ecNo;
  const ecRelation = str(core.emergency_contact_relation);
  if (ecRelation) patch.emergency_contact_relation = ecRelation;
  const ecAddress = str(core.emergency_contact_address);
  if (ecAddress) patch.emergency_contact_address = ecAddress;

  // The driving licence. The form clears all three together when the
  // "Driving Licence Available" box is unticked, so nulls are honoured.
  if (core.driving_license_number !== undefined) {
    patch.driving_license_number = str(core.driving_license_number);
  }
  if (core.driving_license_category !== undefined) {
    patch.driving_license_category = str(core.driving_license_category);
  }
  if (core.driving_license_validity !== undefined) {
    patch.driving_license_validity = dateArg(core.driving_license_validity);
  }

  // Rate per km only means anything when the employee's own vehicle is used.
  if (core.vehicle_km_applicable !== undefined && !bool(core.vehicle_km_applicable)) {
    patch.rate_per_km = null;
  } else {
    const rate = num(core.rate_per_km);
    if (rate !== null && rate >= 0) patch.rate_per_km = rate;
  }

  return patch;
}

/**
 * Who recommended this person.
 *
 * If the referrer is already somebody on the system, we link to their
 * record rather than keeping a loose piece of text -- a name typed twice
 * is two different names as soon as one of them is spelled differently.
 * The screen's picker sends only a display name, so the name is matched
 * against the people on the books; a single clear match is linked, and
 * anything else falls back to storing the name as typed. The name is
 * always kept either way, so nothing the user entered is lost.
 */
async function referrerPatch(
  admin: Caller["admin"],
  core: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const patch: Record<string, unknown> = {};

  const mentioned = core.has_ref_employee !== undefined
    || core.referred_by_name !== undefined || core.ref_employee_name !== undefined
    || core.referred_by_party_id !== undefined || core.ref_employee_id !== undefined
    || core.referred_by_contact !== undefined || core.ref_employee_contact !== undefined;
  if (!mentioned) return patch;

  // The box was unticked: the referral is cleared, not left half there.
  if (core.has_ref_employee !== undefined && !bool(core.has_ref_employee)) {
    return { referred_by_party_id: null, referred_by_name: null, referred_by_contact: null };
  }

  const name = str(core.referred_by_name, core.ref_employee_name);
  const contact = str(core.referred_by_contact, core.ref_employee_contact);
  patch.referred_by_name = name;
  patch.referred_by_contact = contact;

  let linkedId = uuidArg(core.referred_by_party_id, core.ref_employee_id);

  if (!linkedId && name) {
    const { data: matches } = await admin
      .from("parties").select("id, display_name").eq("display_name", name)
      .neq("status", "cancelled").limit(3);
    if ((matches ?? []).length === 1) linkedId = matches![0].id as string;
  }

  if (linkedId) {
    const { data: referrer } = await admin
      .from("parties").select("id, display_name").eq("id", linkedId).maybeSingle();
    if (referrer) {
      patch.referred_by_party_id = referrer.id;
      // Keep the name in step with the record we linked to.
      patch.referred_by_name = referrer.display_name;
      return patch;
    }
  }

  patch.referred_by_party_id = null;
  return patch;
}

/** The address rows a `core` implies. Only complete addresses are kept. */
function addressRowsFromCore(core: Record<string, unknown>, partyId: string, by: string) {
  const rows: Array<Record<string, unknown>> = [];

  const present = str(core.present_address, core.current_address);
  if (present) {
    rows.push({
      party_id: partyId, address_type: "primary", label: "Present", line1: present,
      city_id: uuidArg(core.present_city_id), state_id: uuidArg(core.present_state_id),
      pincode: pincodeArg(core.present_pincode), is_primary: true,
      status: "approved", created_by: by,
    });
  }

  const sameAsPresent = bool(core.same_as_present);
  const permanent = sameAsPresent ? present : str(core.permanent_address);
  if (permanent) {
    rows.push({
      party_id: partyId, address_type: "permanent", label: "Permanent", line1: permanent,
      city_id: uuidArg(sameAsPresent ? core.present_city_id : core.permanent_city_id),
      state_id: uuidArg(sameAsPresent ? core.present_state_id : core.permanent_state_id),
      pincode: pincodeArg(sameAsPresent ? core.present_pincode : core.permanent_pincode),
      is_primary: false, status: "approved", created_by: by,
    });
  }

  return rows;
}

/** The bank row a `core` implies, or null if the details are incomplete. */
function bankRowFromCore(core: Record<string, unknown>, partyId: string, by: string) {
  const accountNumber = str(core.bank_account_number, core.account_number);
  const ifsc = ifscArg(core.bank_ifsc ?? core.ifsc);
  if (!accountNumber || !ifsc) return null;

  return {
    party_id: partyId,
    account_holder_name: str(core.bank_account_holder_name, core.account_holder_name, core.name) ?? "Account holder",
    account_number: accountNumber,
    ifsc,
    bank_name: str(core.bank_name),
    branch_name: str(core.bank_branch, core.branch_name),
    account_type: "savings",
    is_primary: true,
    status: "approved",
    created_by: by,
  };
}

/**
 * Retire the child rows of one kind, then put the new ones in.
 * Nothing is deleted: the old rows stay as 'cancelled' so what the
 * record said last year can still be read.
 */
async function replaceChildRows(
  admin: Caller["admin"],
  table: string,
  partyId: string,
  rows: Array<Record<string, unknown>>,
  extraFilter?: { column: string; value: unknown },
) {
  let q = admin.from(table).update({ status: "cancelled" })
    .eq("party_id", partyId).neq("status", "cancelled");
  if (extraFilter) q = q.eq(extraFilter.column, extraFilter.value);
  const { error: cancelErr } = await q;
  if (cancelErr) throw cancelErr;

  if (rows.length === 0) return;
  const { error: insErr } = await admin.from(table).insert(rows);
  if (insErr) throw insErr;
}

/** Family members and nominees now live in one table, told apart by a flag. */
function familyRowsFromRecords(
  records: Array<Record<string, unknown>>,
  partyId: string,
  by: string,
  asNominee: boolean,
  relationshipIdByName: Map<string, string>,
) {
  const rows: Array<Record<string, unknown>> = [];
  for (const r of records) {
    const fullName = str(r.full_name, r.member_name, r.name);
    if (!fullName) continue;

    let relationshipId = uuidArg(r.relationship_id);
    if (!relationshipId) {
      const relName = str(r.relation, r.relationship)?.toLowerCase();
      if (relName) relationshipId = relationshipIdByName.get(relName) ?? null;
    }

    // The old nominee row held a free "DOB or age" box. Only a real date
    // is kept; a bare age has nowhere sensible to go.
    const dob = dateArg(r.date_of_birth, r.dob, r.dob_or_age);

    rows.push({
      party_id: partyId,
      full_name: fullName,
      relationship_id: relationshipId,
      date_of_birth: dob,
      occupation: str(r.occupation),
      mobile: mobileArg(r.mobile, r.mobile_number, r.contact),
      is_dependent: bool(r.is_dependent),
      is_nominee: asNominee,
      nominee_share_pc: asNominee
        ? (() => { const n = num(r.nominee_share_pc, r.share, r.share_pc); return n !== null && n >= 0 && n <= 100 ? n : null; })()
        : null,
      status: "approved",
      created_by: by,
    });
  }
  return rows;
}

function educationRowsFromRecords(records: Array<Record<string, unknown>>, partyId: string, by: string) {
  const rows: Array<Record<string, unknown>> = [];
  for (const r of records) {
    const qualification = str(r.qualification, r.degree, r.course);
    if (!qualification) continue;
    const year = num(r.year_of_pass, r.passing_year);
    rows.push({
      party_id: partyId,
      qualification,
      institution: str(r.institution, r.institute_name, r.institute),
      board_or_uni: str(r.board_or_uni, r.board_university, r.board),
      year_of_pass: year !== null && year > 1900 && year < 2200 ? Math.trunc(year) : null,
      grade: str(r.grade, r.percentage, r.marks),
      status: "approved",
      created_by: by,
    });
  }
  return rows;
}

function workRowsFromRecords(records: Array<Record<string, unknown>>, partyId: string, by: string) {
  const rows: Array<Record<string, unknown>> = [];
  for (const r of records) {
    const company = str(r.company_name, r.company, r.employer);
    if (!company) continue;
    rows.push({
      party_id: partyId,
      company_name: company,
      // The old screen's free-text "duration" box has no column. If it
      // held real dates they come through from_date/to_date instead.
      designation: str(r.designation, r.position, r.role),
      from_date: dateArg(r.from_date, r.date_from),
      to_date: dateArg(r.to_date, r.date_to),
      last_salary: num(r.last_salary, r.salary),
      reason_for_leaving: str(r.reason_for_leaving, r.reason),
      status: "approved",
      created_by: by,
    });
  }
  return rows;
}

function assetRowsFromRecords(records: Array<Record<string, unknown>>, partyId: string, by: string) {
  const rows: Array<Record<string, unknown>> = [];
  for (const r of records) {
    // The asset_types lookup was dropped; the type is plain text now.
    const assetType = str(r.asset_type, r.asset_type_name, r.type, r.name);
    if (!assetType) continue;
    rows.push({
      party_id: partyId,
      asset_type: assetType,
      description: str(r.description, r.remarks),
      serial_number: str(r.serial_number, r.serial_no),
      issued_on: dateArg(r.issued_on, r.issue_date) ?? todayInIndia(),
      returned_on: dateArg(r.returned_on, r.return_date),
      status: "approved",
      created_by: by,
    });
  }
  return rows;
}

async function relationshipNameIndex(admin: Caller["admin"]) {
  const { data } = await admin.from("relationships").select("id, name");
  const m = new Map<string, string>();
  for (const r of data ?? []) m.set((r.name as string).toLowerCase(), r.id as string);
  return m;
}

/** Salary at joining, if the screen sent any figures. Always a new row. */
async function insertJoiningSalary(
  admin: Caller["admin"],
  core: Record<string, unknown>,
  partyId: string,
  by: string,
  effectiveFrom: string,
) {
  const basic = num(core.salary_basic, core.basic);
  const hra = num(core.salary_hra, core.hra);
  const da = num(core.salary_da, core.da);
  const ta = num(core.salary_ta, core.ta);
  const other = num(core.salary_other_allowance, core.other_allowance);
  if (basic === null && hra === null && da === null && ta === null && other === null) return null;

  const { data, error } = await admin.from("salary_records").insert({
    party_id: partyId,
    effective_from: effectiveFrom,
    basic: Math.max(0, basic ?? 0),
    hra: Math.max(0, hra ?? 0),
    da: Math.max(0, da ?? 0),
    ta: Math.max(0, ta ?? 0),
    other_allowance: Math.max(0, other ?? 0),
    reason: "joining",
    status: "approved",
    approved_by: by,
    created_by: by,
  }).select().single();
  if (error && error.code !== "23505") throw error;
  return data ?? null;
}

async function createEmployee(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "employee_master.create");
  const admin = me.admin;

  // The Employee Master form sends `core`; the quick-add box on the Km
  // Tracker screen sends the same fields loose at the top level.
  const core = ((body.core ?? body.employee ?? body) as Record<string, unknown>) ?? {};

  const name = str(core.name, core.display_name, core.full_name);
  if (!name) throw new AuthError("A name is required.", 400);

  const mobile = mobileArg(core.mobile_number, core.primary_mobile, core.mobile);
  if (!mobile) {
    throw new AuthError("A ten-digit Indian mobile number is required.", 400);
  }

  const { data: clash } = await admin
    .from("parties").select("id, display_name")
    .eq("primary_mobile", mobile).neq("status", "cancelled").maybeSingle();
  if (clash) {
    throw new AuthError(`That mobile number is already on ${clash.display_name}'s record.`, 409);
  }

  // Both patches are worked out BEFORE anything is written. A word the
  // database would refuse -- a wage type that is not on the list, say --
  // has to fail here, while nothing exists yet. Building them after the
  // `parties` row went in would leave a half-made person behind and burn
  // an employee number on nobody.
  const partyPatch = partyPatchFromCore(core);
  const employmentPatch = {
    ...employmentPatchFromCore(core),
    ...(await referrerPatch(admin, core)),
  };

  // The human-readable number is allocated by the database, never typed in.
  const { data: partyNumber, error: numErr } = await admin
    .rpc("next_human_number", { p_series_key: "employee" });
  if (numErr) throw numErr;

  const { data: party, error: partyErr } = await admin.from("parties").insert({
    ...partyPatch,
    party_type: "person",
    party_number: partyNumber,
    display_name: name,
    primary_mobile: mobile,
    status: "approved",
    created_by: me.partyId,
  }).select().single();
  if (partyErr) {
    if (partyErr.code === "23505") {
      throw new AuthError("Some of those details are already on another person's record.", 409);
    }
    throw partyErr;
  }
  const partyId = party.id as string;

  // What they are: an employee. 'owner' is never granted from here.
  const { error: roleErr } = await admin.from("party_roles").insert({
    party_id: partyId, role: "employee", status: "approved",
    role_from: dateArg(core.date_of_joining) ?? todayInIndia(),
    created_by: me.partyId,
  });
  if (roleErr) throw roleErr;

  const { data: employment, error: empErr } = await admin.from("employee_details").insert({
    ...employmentPatch,
    party_id: partyId,
    employment_state: "active",
    status: "approved",
    created_by: me.partyId,
  }).select().single();
  if (empErr) throw empErr;

  // ---- the children, if the same call carried them ----
  const relIndex = await relationshipNameIndex(admin);
  const doj = dateArg(core.date_of_joining) ?? todayInIndia();

  const addressRows = addressRowsFromCore(core, partyId, me.partyId);
  if (addressRows.length) {
    const { error } = await admin.from("party_addresses").insert(addressRows);
    if (error) throw error;
  }

  const bankRow = bankRowFromCore(core, partyId, me.partyId);
  if (bankRow) {
    const { error } = await admin.from("party_bank_accounts").insert(bankRow);
    if (error) throw error;
  }

  const contacts = Array.isArray(body.contacts) ? body.contacts as Array<Record<string, unknown>> : [];
  const contactRows = contacts
    .filter((c) => str(c.contact_name, c.name))
    .map((c) => ({
      party_id: partyId,
      contact_name: str(c.contact_name, c.name)!,
      designation: str(c.designation),
      department: str(c.department),
      mobile: mobileArg(c.mobile),
      alt_mobile: mobileArg(c.alt_mobile),
      email: str(c.email),
      purpose: str(c.purpose),
      is_primary: bool(c.is_primary),
      status: "approved",
      created_by: me.partyId,
    }));
  if (contactRows.length) {
    const { error } = await admin.from("party_contacts").insert(contactRows);
    if (error) throw error;
  }

  const family = Array.isArray(body.family) ? body.family as Array<Record<string, unknown>> : [];
  const nominees = Array.isArray(body.nominees) ? body.nominees as Array<Record<string, unknown>> : [];
  const familyRows = [
    ...familyRowsFromRecords(family, partyId, me.partyId, false, relIndex),
    ...familyRowsFromRecords(nominees, partyId, me.partyId, true, relIndex),
  ];
  if (familyRows.length) {
    const { error } = await admin.from("party_family_members").insert(familyRows);
    if (error) throw error;
  }

  const education = Array.isArray(body.education) ? body.education as Array<Record<string, unknown>> : [];
  const eduRows = educationRowsFromRecords(education, partyId, me.partyId);
  if (eduRows.length) {
    const { error } = await admin.from("party_education").insert(eduRows);
    if (error) throw error;
  }

  const work = Array.isArray(body.work_experience ?? body.workExperience)
    ? (body.work_experience ?? body.workExperience) as Array<Record<string, unknown>> : [];
  const workRows = workRowsFromRecords(work, partyId, me.partyId);
  if (workRows.length) {
    const { error } = await admin.from("party_work_experience").insert(workRows);
    if (error) throw error;
  }

  const assets = Array.isArray(body.assets) ? body.assets as Array<Record<string, unknown>> : [];
  const assetRows = assetRowsFromRecords(assets, partyId, me.partyId);
  if (assetRows.length) {
    const { error } = await admin.from("employee_assets").insert(assetRows);
    if (error) throw error;
  }

  const salary = await insertJoiningSalary(admin, core, partyId, me.partyId, doj);

  const look = await loadLookups(admin);
  const shaped = shapeEmployeeRow(party, employment, ["employee"], undefined, look, null);

  return json({
    success: true,
    employee: shaped,
    party,
    employment,
    party_number: partyNumber,
    employee_code: partyNumber,     // legacy alias
    current_salary: salary,
    // Tokyo handed back a PIN here. There are no PINs any more.
    generatedPin: null,
  }, 200);
}

async function updateEmployee(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "employee_master.edit");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id, body.id);
  if (!partyId) throw new AuthError("Which employee?", 400);
  const core = ((body.core ?? body.employee ?? {}) as Record<string, unknown>) ?? {};

  const { data: existing } = await admin
    .from("parties").select("id, status").eq("id", partyId).maybeSingle();
  if (!existing) throw new AuthError("That employee was not found.", 404);

  // Both patches first, so a word the database would refuse stops the
  // whole edit rather than leaving half of it applied.
  const partyPatch = partyPatchFromCore(core);
  const empPatch = { ...employmentPatchFromCore(core), ...(await referrerPatch(admin, core)) };

  if (partyPatch.primary_mobile) {
    const { data: clash } = await admin
      .from("parties").select("id, display_name")
      .eq("primary_mobile", partyPatch.primary_mobile)
      .neq("id", partyId).neq("status", "cancelled").maybeSingle();
    if (clash) {
      throw new AuthError(`That mobile number is already on ${clash.display_name}'s record.`, 409);
    }
  }

  let party = existing as Record<string, unknown>;
  if (Object.keys(partyPatch).length > 0) {
    const { data, error } = await admin
      .from("parties").update(partyPatch).eq("id", partyId).select().single();
    if (error) {
      if (error.code === "23505") {
        throw new AuthError("Some of those details are already on another person's record.", 409);
      }
      throw error;
    }
    party = data;
  } else {
    const { data } = await admin.from("parties").select("*").eq("id", partyId).single();
    party = data as Record<string, unknown>;
  }

  let employment: Record<string, unknown> | null = null;
  if (Object.keys(empPatch).length > 0) {
    const { data, error } = await admin
      .from("employee_details").update(empPatch).eq("party_id", partyId).select().maybeSingle();
    if (error) throw error;
    employment = data;
  }
  if (!employment) {
    const { data } = await admin
      .from("employee_details").select("*").eq("party_id", partyId).maybeSingle();
    employment = data;
  }

  // Addresses and bank are replaced wholesale when the form sends them,
  // and left exactly alone when it does not.
  const addressRows = addressRowsFromCore(core, partyId, me.partyId);
  if (addressRows.length) {
    await replaceChildRows(admin, "party_addresses", partyId, addressRows);
  }
  const bankRow = bankRowFromCore(core, partyId, me.partyId);
  if (bankRow) {
    await replaceChildRows(admin, "party_bank_accounts", partyId, [bankRow]);
  }

  const { data: roleRows } = await admin
    .from("party_roles").select("role").eq("party_id", partyId).eq("status", "approved");
  const { data: account } = await admin
    .from("user_accounts").select("party_id, login_email, is_locked, status")
    .eq("party_id", partyId).maybeSingle();

  const look = await loadLookups(admin);
  const shaped = shapeEmployeeRow(
    party, employment ?? undefined,
    (roleRows ?? []).map((r) => r.role as string),
    account ?? undefined, look, null,
  );

  return json({ success: true, employee: shaped, party, employment }, 200);
}

// ---------- the repeating sections ----------

const CHILD_TABLE_ALIASES: Record<string, string> = {
  employee_family_members: "family",
  party_family_members: "family",
  family: "family",
  employee_nominees: "nominees",
  nominees: "nominees",
  employee_education: "education",
  party_education: "education",
  education: "education",
  employee_work_experience: "work",
  party_work_experience: "work",
  work_experience: "work",
  employee_assets: "assets",
  assets: "assets",
};

async function saveChildRecords(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "employee_master.edit");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Which employee?", 400);

  const kind = CHILD_TABLE_ALIASES[str(body.table, body.section) ?? ""];
  if (!kind) throw new AuthError("That is not a section we keep.", 400);

  const records = Array.isArray(body.records) ? body.records as Array<Record<string, unknown>> : null;
  if (!records) throw new AuthError("No records were sent.", 400);

  const { data: person } = await admin.from("parties").select("id").eq("id", partyId).maybeSingle();
  if (!person) throw new AuthError("That employee was not found.", 404);

  if (kind === "family" || kind === "nominees") {
    // One table now holds both. Only the half being saved is replaced,
    // so saving the family list does not wipe the nominees.
    const asNominee = kind === "nominees";
    const relIndex = await relationshipNameIndex(admin);
    const rows = familyRowsFromRecords(records, partyId, me.partyId, asNominee, relIndex);
    await replaceChildRows(admin, "party_family_members", partyId, rows,
      { column: "is_nominee", value: asNominee });
    return json({ success: true, saved: rows.length }, 200);
  }

  if (kind === "education") {
    const rows = educationRowsFromRecords(records, partyId, me.partyId);
    await replaceChildRows(admin, "party_education", partyId, rows);
    return json({ success: true, saved: rows.length }, 200);
  }

  if (kind === "work") {
    const rows = workRowsFromRecords(records, partyId, me.partyId);
    await replaceChildRows(admin, "party_work_experience", partyId, rows);
    return json({ success: true, saved: rows.length }, 200);
  }

  const rows = assetRowsFromRecords(records, partyId, me.partyId);
  await replaceChildRows(admin, "employee_assets", partyId, rows);
  return json({ success: true, saved: rows.length }, 200);
}

// ============================================================
//  employment state -- suspend, mark left, resume
// ============================================================
// Nobody is ever deleted. The record stays; only the state changes.

async function changeEmploymentState(me: Caller, body: Record<string, unknown>, forced?: string) {
  requirePermission(me, "employee_master.delete");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Which employee?", 400);

  const newState = forced ?? str(body.new_status, body.employment_state, body.state);
  if (!newState || !["active", "suspended", "left"].includes(newState)) {
    throw new AuthError("That is not an employment state we know.", 400);
  }

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
    patch.date_of_leaving = dateArg(body.date_of_leaving) ?? todayInIndia();
    const reason = str(body.reason, body.leaving_reason);
    if (reason) patch.leaving_reason = reason;
    patch.assigned_vehicle_id = null;      // the vehicle goes back
  }
  if (newState === "active") {
    patch.date_of_leaving = null;
    patch.leaving_reason = null;
  }

  const { data: updated, error } = await admin
    .from("employee_details").update(patch).eq("party_id", partyId)
    .select("party_id, employment_state, date_of_leaving, leaving_reason, assigned_vehicle_id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw new AuthError("That person has no employment record.", 404);

  // Someone who has left, or is suspended, cannot sign in. Coming back
  // unlocks them again -- their login is never thrown away.
  const { data: account } = await admin
    .from("user_accounts").select("id").eq("party_id", partyId).maybeSingle();
  if (account) {
    await admin.from("user_accounts")
      .update({ is_locked: newState !== "active" })
      .eq("party_id", partyId);
  }

  const { data: party } = await admin
    .from("parties").select("id, display_name, party_number").eq("id", partyId).maybeSingle();

  return json({
    success: true,
    employee: {
      id: partyId,
      party_id: partyId,
      name: party?.display_name ?? null,
      display_name: party?.display_name ?? null,
      employee_code: party?.party_number ?? null,
      status: updated.employment_state,             // legacy alias
      employment_state: updated.employment_state,
      date_of_leaving: updated.date_of_leaving,
      leaving_reason: updated.leaving_reason,
    },
  }, 200);
}

// ============================================================
//  pay -- a dated history, never a column that gets overwritten
// ============================================================

const SALARY_REASONS = ["joining", "appraisal", "promotion", "correction", "other"];

async function addSalaryRecord(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "payroll.edit");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Which employee?", 400);

  const effectiveFrom = dateArg(body.effective_from, body.effective_date);
  if (!effectiveFrom) {
    throw new AuthError("A date for the new salary to start from is required.", 400);
  }

  const reason = str(body.reason) ?? "appraisal";
  if (!SALARY_REASONS.includes(reason)) {
    throw new AuthError(`Reason must be one of: ${SALARY_REASONS.join(", ")}.`, 400);
  }

  const basic = num(body.basic, body.salary_basic) ?? 0;
  const hra = num(body.hra, body.salary_hra) ?? 0;
  const da = num(body.da, body.salary_da) ?? 0;
  const ta = num(body.ta, body.salary_ta) ?? 0;
  const other = num(body.other_allowance, body.salary_other_allowance) ?? 0;
  if ([basic, hra, da, ta, other].some((n) => n < 0)) {
    throw new AuthError("A salary figure cannot be negative.", 400);
  }
  if (basic + hra + da + ta + other <= 0) {
    throw new AuthError("The salary cannot be zero.", 400);
  }

  const { data: person } = await admin
    .from("employee_details").select("party_id").eq("party_id", partyId).maybeSingle();
  if (!person) throw new AuthError("That employee was not found.", 404);

  // A brand new row every time. The earlier rows are left exactly as they
  // are, so what somebody was paid in a past month is still on record.
  const { data: record, error } = await admin.from("salary_records").insert({
    party_id: partyId,
    effective_from: effectiveFrom,
    basic, hra, da, ta, other_allowance: other,
    reason,
    remarks: str(body.remarks),
    status: "approved",
    approved_by: me.partyId,
    created_by: me.partyId,
  }).select().single();

  if (error) {
    if (error.code === "23505") {
      throw new AuthError(
        `A salary already starts on ${effectiveFrom} for this employee. Pick another date.`,
        409,
      );
    }
    throw error;
  }

  const { data: current } = await admin.rpc("current_salary", { p_party_id: partyId });
  return json({ success: true, salary: record, current_salary: current ?? null }, 200);
}

async function getSalaryHistory(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "payroll.view");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Which employee?", 400);

  const { data: history, error } = await admin
    .from("salary_records").select("*").eq("party_id", partyId)
    .order("effective_from", { ascending: false });
  if (error) throw error;

  const { data: current } = await admin.rpc("current_salary", { p_party_id: partyId });

  const withTotals = (history ?? []).map((r) => ({
    ...r,
    gross: Number(r.basic) + Number(r.hra) + Number(r.da) + Number(r.ta) + Number(r.other_allowance),
  }));

  return json({
    success: true,
    salary_history: withTotals,
    history: withTotals,                 // friendlier alias
    current_salary: current ?? null,
  }, 200);
}

// ============================================================
//  documents
// ============================================================

async function uploadDocument(me: Caller, req: Request, body: Record<string, unknown>) {
  requirePermission(me, "employee_master.edit");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Which employee?", 400);

  const slot = str(body.slot, body.doc_category) ?? "other";
  const raw = str(body.file_base64, body.file);
  if (!raw) throw new AuthError("No file was sent.", 400);

  const { data: person } = await admin
    .from("parties").select("id").eq("id", partyId).maybeSingle();
  if (!person) throw new AuthError("That employee was not found.", 404);

  const base64 = raw.includes(",") ? raw.split(",")[1] : raw;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    throw new AuthError("That file could not be read.", 400);
  }

  // The file is checked by its own first bytes, never by what it is
  // called. This is what stops a program arriving as "aadhaar.pdf".
  const declared = str(body.file_mime, body.mime_type) ?? "";
  const realMime = checkFileBytes(bytes, declared, MAX_UPLOAD_BYTES);

  const category = docCategoryForSlot(slot);
  if (category === "photo" && realMime === "application/pdf") {
    throw new AuthError("A photo has to be a picture, not a PDF.", 400);
  }

  const ext = realMime === "application/pdf" ? "pdf" : realMime === "image/png" ? "png" : "jpg";
  const fileName = str(body.document_name, body.file_name) ?? `${slot}.${ext}`;
  const path = `parties/${partyId}/${category}_${Date.now()}.${ext}`;

  const { error: upErr } = await admin.storage
    .from(DOC_BUCKET).upload(path, bytes, { contentType: realMime, upsert: false });
  if (upErr) throw new AuthError(`The file could not be stored: ${upErr.message}`, 500);

  // Is there already a current file in this slot? 'other' can hold many;
  // every named slot holds one, and putting a new one in replaces it.
  let prior: { id: string } | null = null;
  if (category !== "other") {
    const { data } = await admin.from("attachments")
      .select("id").eq("entity_table", "parties").eq("entity_id", partyId)
      .eq("doc_category", category).eq("is_current", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    prior = data;
  }

  let attachmentId: string;

  if (prior) {
    // Replacing goes through the database's own function, which keeps the
    // old version and marks it superseded. A file is never deleted.
    attachmentId = await replaceViaFunction(me, req, prior.id, fileName, realMime, bytes.length, path);
  } else {
    const { data: att, error: attErr } = await admin.from("attachments").insert({
      entity_table: "parties",
      entity_id: partyId,
      party_id: partyId,
      doc_category: category,
      title: slot,
      file_name: fileName,
      mime_type: realMime,
      size_bytes: bytes.length,
      storage_bucket: DOC_BUCKET,
      storage_path: path,
      scan_status: "clean",
      scan_engine: SCAN_ENGINE,
      scan_result: SCAN_NOTE,
      scanned_at: new Date().toISOString(),
      is_current: true,
      status: "approved",
      created_by: me.partyId,
    }).select("id").single();
    if (attErr) throw attErr;
    attachmentId = att.id as string;
  }

  const { data: saved } = await admin.from("attachments").select("*").eq("id", attachmentId).single();
  const [shaped] = await signAttachments(admin, [saved as Record<string, unknown>]);

  return json({
    success: true,
    document: shaped,
    // legacy alias -- the old screen read photo_url off the reply
    photo_url: category === "photo" ? shaped.signed_url : undefined,
  }, 200);
}

/**
 * Hand a replacement to `public.replace_attachment`, which keeps the old
 * version and decides for itself whether this person may do it. It runs
 * as the caller, not as the service role, so its own permission check is
 * real. The new row it makes starts life 'pending'; the byte check has
 * already passed by the time we get here, so it is marked clean after.
 */
async function replaceViaFunction(
  me: Caller,
  req: Request,
  oldId: string,
  fileName: string,
  mime: string,
  sizeBytes: number,
  path: string,
): Promise<string> {
  const asCaller = callerScopedClient(req);
  const { data: newId, error } = await asCaller.rpc("replace_attachment", {
    p_old_id: oldId,
    p_file_name: fileName,
    p_mime_type: mime,
    p_size_bytes: sizeBytes,
    p_storage_bucket: DOC_BUCKET,
    p_storage_path: path,
    p_checksum: null,
  });

  if (error || !newId) {
    // If the function could not be reached, do the same thing by hand --
    // the old row is kept and marked superseded, exactly as it would be.
    const { data: old } = await me.admin.from("attachments").select("*").eq("id", oldId).single();
    await me.admin.from("attachments").update({
      is_current: false,
      replaced_at: new Date().toISOString(),
      replaced_by: me.partyId,
    }).eq("id", oldId);

    const { data: fresh, error: insErr } = await me.admin.from("attachments").insert({
      entity_table: old.entity_table,
      entity_id: old.entity_id,
      party_id: old.party_id,
      doc_category: old.doc_category,
      title: old.title,
      file_name: fileName,
      mime_type: mime,
      size_bytes: sizeBytes,
      storage_bucket: DOC_BUCKET,
      storage_path: path,
      version: Number(old.version) + 1,
      replaces_id: oldId,
      is_current: true,
      scan_status: "clean",
      scan_engine: SCAN_ENGINE,
      scan_result: SCAN_NOTE,
      scanned_at: new Date().toISOString(),
      status: "approved",
      created_by: me.partyId,
    }).select("id").single();
    if (insErr) throw insErr;
    return fresh.id as string;
  }

  await me.admin.from("attachments").update({
    scan_status: "clean",
    scan_engine: SCAN_ENGINE,
    scan_result: SCAN_NOTE,
    scanned_at: new Date().toISOString(),
    status: "approved",
  }).eq("id", newId as string);

  return newId as string;
}

async function listDocuments(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "employee_master.view");
  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Which employee?", 400);

  const { data, error } = await me.admin.from("attachments").select("*")
    .eq("entity_table", "parties").eq("entity_id", partyId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const current = (data ?? []).filter((d) => d.is_current);
  return json({
    success: true,
    documents: await signAttachments(me.admin, current),
    all_versions: await signAttachments(me.admin, data ?? []),
  }, 200);
}

// ============================================================
//  logins
// ============================================================

/**
 * A password nobody will ever know, including us. It exists only so the
 * Auth row is well formed; the person gets in through the "forgotten
 * password" link, which is the only way in. It is never returned, never
 * stored in a table of ours, and never emailed from here.
 */
function unknowablePassword(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + "aA1!";
}

async function createEmployeeLogin(me: Caller, body: Record<string, unknown>) {
  requirePermission(me, "admin.users");
  const admin = me.admin;

  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Which employee?", 400);

  const { data: party } = await admin
    .from("parties").select("id, display_name, party_number, primary_email, status")
    .eq("id", partyId).maybeSingle();
  if (!party) throw new AuthError("That employee was not found.", 404);
  if (party.status === "cancelled") {
    throw new AuthError("That record is cancelled. It cannot be given a login.", 400);
  }

  const { data: existing } = await admin
    .from("user_accounts").select("login_email").eq("party_id", partyId).maybeSingle();
  if (existing) {
    throw new AuthError(`This person already signs in as ${existing.login_email}.`, 409);
  }

  // Their real email if they have one; otherwise one built from the
  // number the database gave them -- emp-0014@refconveyors.net.
  const asked = str(body.login_email, body.email)?.toLowerCase();
  const real = str(party.primary_email)?.toLowerCase();
  const fallback = party.party_number
    ? `${String(party.party_number).toLowerCase()}@refconveyors.net`
    : null;
  const loginEmail = asked ?? real ?? fallback;
  if (!loginEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginEmail)) {
    throw new AuthError("There is no email address to sign in with, and no employee number to build one from.", 400);
  }

  // The Auth row, its identity and the link to the person are all made
  // by one database function, so the GoTrue columns that must be empty
  // strings rather than NULL are set right in one place, forever.
  const { data: authUserId, error } = await admin.rpc("create_login_for_party", {
    p_party_id: partyId,
    p_login_email: loginEmail,
    p_password: unknowablePassword(),
  });
  if (error) {
    const msg = error.message ?? "";
    if (/already/i.test(msg)) throw new AuthError(msg.replace(/^.*?:\s*/, ""), 409);
    throw error;
  }

  return json({
    success: true,
    account: {
      party_id: partyId,
      auth_user_id: authUserId,
      login_email: loginEmail,
      must_change_password: true,
      two_step_enabled: false,
    },
    message: `${party.display_name} can now sign in as ${loginEmail}. `
      + `Tell them to use "Forgot password" on the sign-in page to set their own password — `
      + `nobody, here or anywhere, knows what the password currently is.`,
  }, 200);
}

async function setLoginLocked(me: Caller, body: Record<string, unknown>, locked: boolean) {
  requirePermission(me, "admin.users");
  const partyId = uuidArg(body.party_id, body.employee_id);
  if (!partyId) throw new AuthError("Which employee?", 400);

  if (locked && partyId === me.partyId) {
    throw new AuthError("You cannot lock yourself out.", 400);
  }

  const { data, error } = await me.admin
    .from("user_accounts").update({ is_locked: locked })
    .eq("party_id", partyId).select("party_id, login_email, is_locked").maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError("That person has no login.", 404);

  return json({ success: true, account: data }, 200);
}

// ============================================================
//  the actions the old function had that no longer exist
// ============================================================
// The login-request queue is gone: `erp_login_requests`, the PINs, the
// temporary passwords and `employee_sessions` all went with Tokyo. The
// screen still asks for them, so each one answers plainly instead of
// failing with "Unknown action".

function retiredRequestQueue() {
  // An empty feed. The Home tab shows nothing pending, which is true.
  return json({ success: true, requests: [] }, 200);
}

function retiredLoginFlow(): never {
  throw new AuthError(
    "ERP access is no longer requested and approved. Someone with "
    + "\"Manage Logins & Two-Step\" creates the login directly, and the "
    + "person sets their own password with the \"Forgot password\" link.",
    400,
  );
}

function retiredPin(): never {
  throw new AuthError(
    "There are no PINs any more. Signing in is by email and password; "
    + "a forgotten password is reset with the \"Forgot password\" link, "
    + "which nobody else can read.",
    400,
  );
}

function retiredDocumentDelete(): never {
  throw new AuthError(
    "A document is never deleted. Upload the correct file in the same "
    + "slot and it replaces this one, with the old version kept.",
    400,
  );
}

// ============================================================

Deno.serve((req) => handle(req, async () => {
  // Who is calling comes from the token and nothing else. Whatever the
  // body claims about identity -- requester_id, employee_id-as-me, any
  // of it -- is read past and thrown away.
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
    // ---- lists behind the pickers ----
    case "get_dropdowns":          return await getDropdowns(me);
    case "add_dropdown_item":
    case "create_dropdown_item":   return await addDropdownItem(me, body);
    case "rename_dropdown_item":
    case "update_dropdown_item":   return await renameDropdownItem(me, body);
    case "retire_dropdown_item":
    case "delete_dropdown_item":   return await setDropdownStatus(me, body, false);
    case "restore_dropdown_item":  return await setDropdownStatus(me, body, true);
    case "toggle_dropdown_item":   return await setDropdownStatus(me, body, null);

    // ---- people ----
    case "get_employee_list":
    case "search_employees":       return await getEmployeeList(me, body);
    case "get_employee_detail":    return await getEmployeeDetail(me, body);
    case "create_employee":
    case "add_employee":           return await createEmployee(me, body);
    case "update_employee":        return await updateEmployee(me, body);
    case "save_child_records":     return await saveChildRecords(me, body);

    // ---- employment state ----
    case "update_employee_status": return await changeEmploymentState(me, body);
    case "suspend_employee":
    case "initiate_removal":       return await changeEmploymentState(me, body, "suspended");
    case "mark_employee_left":
    case "approve_removal":        return await changeEmploymentState(me, body, "left");
    case "resume_employee":        return await changeEmploymentState(me, body, "active");

    // ---- pay ----
    case "add_salary_record":
    case "add_salary":             return await addSalaryRecord(me, body);
    case "get_salary_history":     return await getSalaryHistory(me, body);

    // ---- files ----
    case "upload_document":
    case "replace_document":       return await uploadDocument(me, req, body);
    case "get_documents":          return await listDocuments(me, body);
    case "delete_document":        return retiredDocumentDelete();

    // ---- logins ----
    case "create_employee_login":
    case "create_login":           return await createEmployeeLogin(me, body);
    case "revoke_employee_erp_access":
    case "lock_login":             return await setLoginLocked(me, body, true);
    case "unlock_login":           return await setLoginLocked(me, body, false);

    // ---- retired with Tokyo ----
    case "get_pending_erp_requests":
    case "get_my_erp_requests":       return retiredRequestQueue();
    case "request_employee_erp_access":
    case "approve_erp_login_request":
    case "reject_erp_login_request":  return retiredLoginFlow();
    case "reset_pin":                 return retiredPin();

    default:
      throw new AuthError("Unknown action", 400);
  }
}));
