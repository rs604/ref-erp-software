// ============================================================
// _shared/auth.ts — the one place that decides who is calling.
//
// Every function includes this file. No function is allowed to work
// out the caller's identity for itself, and no function may take an
// identity from the request body. That was the Tokyo mistake:
// `requester_id` in the body meant anyone who knew a UUID could act
// as that person. Here, identity comes only from the signed token
// Supabase Auth issued, which cannot be forged.
// ============================================================

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface Caller {
  admin: SupabaseClient;
  authUserId: string;
  partyId: string;
  name: string;
  partyNumber: string | null;
  email: string;
  roles: string[];
  isOwner: boolean;
  permissions: string[];
  employmentState: string | null;
  assignedVehicleId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** Thrown for anything the caller is not allowed to do. */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/**
 * Work out who is calling, entirely from the token.
 * Throws AuthError if there is no valid session, the login is not
 * linked to a person, or that person is not active.
 */
export async function authenticate(req: Request): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new AuthError("Not signed in", 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) throw new AuthError("Not signed in", 401);
  const authUserId = userData.user.id;

  const { data: account, error: accErr } = await admin
    .from("user_accounts")
    .select("id, party_id, login_email, is_locked, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (accErr) throw accErr;
  if (!account) throw new AuthError("This login is not linked to an employee record.", 403);
  if (account.status !== "approved") throw new AuthError("This account is not active.", 403);
  if (account.is_locked) throw new AuthError("This account is locked. Contact the owner.", 403);

  const { data: party } = await admin
    .from("parties")
    .select("id, display_name, party_number, status")
    .eq("id", account.party_id)
    .maybeSingle();
  if (!party || party.status === "cancelled") {
    throw new AuthError("This account is no longer active.", 403);
  }

  const { data: roleRows } = await admin
    .from("party_roles")
    .select("role")
    .eq("party_id", account.party_id)
    .eq("status", "approved");
  const roles = (roleRows ?? []).map((r) => r.role as string);
  const isOwner = roles.includes("owner");

  let permissions: string[] = [];
  if (isOwner) {
    const { data: allPerms } = await admin
      .from("permissions").select("key").eq("status", "approved");
    permissions = (allPerms ?? []).map((p) => p.key as string);
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

  const { data: employee } = await admin
    .from("employee_details")
    .select("employment_state, assigned_vehicle_id")
    .eq("party_id", account.party_id)
    .maybeSingle();

  return {
    admin,
    authUserId,
    partyId: account.party_id,
    name: party.display_name,
    partyNumber: party.party_number,
    email: account.login_email,
    roles,
    isOwner,
    permissions,
    employmentState: employee?.employment_state ?? null,
    assignedVehicleId: employee?.assigned_vehicle_id ?? null,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  };
}

/** Throws unless the caller holds this permission. Owner holds everything. */
export function requirePermission(caller: Caller, key: string): void {
  if (caller.isOwner) return;
  if (!caller.permissions.includes(key)) {
    throw new AuthError("You do not have permission to do that.", 403);
  }
}

/** Throws unless the caller is currently working here. */
export function requireActiveEmployee(caller: Caller): void {
  if (caller.isOwner) return;
  if (caller.employmentState !== "active") {
    throw new AuthError("This account is not active.", 403);
  }
}

/** Wraps a handler so every function reports errors the same way. */
export async function handle(
  req: Request,
  fn: (req: Request) => Promise<Response>,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    return await fn(req);
  } catch (err) {
    if (err instanceof AuthError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}

// ---------- File checks, applied to every upload ----------

const SIGNATURES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },           // %PDF
  { mime: "image/jpeg",      bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png",       bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/**
 * Confirms the file really is what it claims to be, by reading its first
 * bytes rather than trusting the name or the declared type. This is what
 * stops a program being uploaded as "invoice.pdf".
 * Returns the mime type actually detected.
 */
export function checkFileBytes(bytes: Uint8Array, declaredMime: string, maxBytes: number): string {
  if (bytes.length === 0) throw new AuthError("That file is empty.", 400);
  if (bytes.length > maxBytes) {
    throw new AuthError(
      `That file is too large. The limit is ${Math.round(maxBytes / 1048576)} MB.`, 400);
  }

  const match = SIGNATURES.find((sig) =>
    sig.bytes.every((b, i) => bytes[(sig.offset ?? 0) + i] === b)
  );

  if (!match) {
    throw new AuthError(
      "Only PDF, JPG and PNG files are accepted. That file is something else, whatever it is named.",
      400,
    );
  }
  if (declaredMime && declaredMime !== match.mime) {
    throw new AuthError(
      `That file says it is ${declaredMime} but it is actually ${match.mime}. It was not saved.`,
      400,
    );
  }
  return match.mime;
}

/**
 * What we currently know about a file's safety.
 * Signature checking blocks the realistic attack -- an executable renamed
 * to .pdf. It is NOT antivirus. When a scanning service is connected this
 * is the one place that changes.
 */
export const SCAN_ENGINE = "signature-check-v1";
export const SCAN_NOTE =
  "File type verified from its own bytes. No antivirus engine is connected yet.";
