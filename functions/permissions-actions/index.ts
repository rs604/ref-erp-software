// ============================================================
// permissions-actions — the Permissions screen's back end.
//
// This function can hand out powers, so it is the one that must be
// hardest to fool.
//
// The Tokyo version read `requester_id` out of the request body and
// believed it. Anyone who could guess a UUID could grant themselves
// everything. Here the caller comes only from authenticate(req), which
// reads the signed token Supabase Auth issued. Any identity field that
// turns up in the body is ignored on purpose.
//
// Two more rules that differ from Tokyo:
//   1. Nothing is deleted. A revoke sets status = 'cancelled' so the
//      row, and the audit trail behind it, stays.
//   2. Who may manage permissions is itself a permission
//      ('admin.permissions'), not a hard-coded role check. The owner
//      passes automatically. Anyone else can be given the job from the
//      settings screen instead of by editing this file.
// ============================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate,
  AuthError,
  Caller,
  handle,
  json,
  requirePermission,
} from "../_shared/auth.ts";

const MANAGE = "admin.permissions";

interface PermissionRow {
  id: string;
  key: string;
  sub_head: string;
  action: string;
  label: string;
  category: string;
  sort_order: number;
  status: string;
}

/**
 * The person a request is about — never the person making it.
 * The screen still says "employee_id"; both spellings are accepted.
 */
function targetPartyId(body: Record<string, unknown>): string {
  const id = (body.party_id ?? body.employee_id) as string | undefined;
  if (!id || typeof id !== "string") {
    throw new AuthError("Which employee? No party_id was given.", 400);
  }
  return id;
}

/** Look a permission up by id or by key, so the screen may send either. */
async function findPermission(
  caller: Caller,
  body: Record<string, unknown>,
): Promise<PermissionRow> {
  const id = body.permission_id as string | undefined;
  const key = body.permission_key as string | undefined;
  if (!id && !key) throw new AuthError("Which permission? None was named.", 400);

  const q = caller.admin.from("permissions").select("*");
  const { data, error } = id ? await q.eq("id", id).maybeSingle() : await q.eq("key", key!).maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError("That permission does not exist.", 400);
  return data as PermissionRow;
}

/** The person being changed, with enough about them to apply the guards. */
async function loadTarget(caller: Caller, partyId: string) {
  const { data: party, error } = await caller.admin
    .from("parties")
    .select("id, display_name, party_number, status")
    .eq("id", partyId)
    .maybeSingle();
  if (error) throw error;
  if (!party) throw new AuthError("That employee does not exist.", 400);
  if (party.status === "cancelled") {
    throw new AuthError(`${party.display_name}'s record has been cancelled, so it cannot be changed.`, 400);
  }

  const { data: roleRows } = await caller.admin
    .from("party_roles")
    .select("role")
    .eq("party_id", partyId)
    .eq("status", "approved");
  const roles = (roleRows ?? []).map((r) => r.role as string);

  return { ...party, roles, isOwner: roles.includes("owner") };
}

/**
 * The owner's powers come from party_roles, not from this table.
 * Adding or removing rows here would say nothing about what they can do,
 * so we refuse rather than pretend it worked.
 */
function refuseIfOwner(target: { display_name: string; isOwner: boolean }) {
  if (target.isOwner) {
    throw new AuthError(
      `${target.display_name} is the Owner. The Owner holds every permission through the owner role, ` +
        `not through this screen, so nothing here can be added to or taken away from them. ` +
        `To change that, the owner role itself has to change.`,
      400,
    );
  }
}

/** Nobody may lock themselves out of the screen they are standing on. */
function refuseSelfDemotion(caller: Caller, partyId: string, key: string) {
  if (partyId === caller.partyId && key === MANAGE) {
    throw new AuthError(
      "You cannot take away your own permission to manage permissions. " +
        "Ask the Owner, or somebody else who holds it, to do that for you.",
      400,
    );
  }
}

/**
 * Notes who did it.
 *
 * The trigger on party_permissions already records what changed, but it
 * takes the actor from auth.uid(), which is empty when a function calls in
 * with the service key. So the row change is logged with no name against
 * it. This second line names the hand that made it.
 *
 * audit_log.action only accepts insert / update / delete, so the plain
 * English of what happened goes in new_row.intent.
 */
async function noteInAudit(
  caller: Caller,
  rowId: string | null,
  intent: string,
  detail: Record<string, unknown>,
) {
  await caller.admin.from("audit_log").insert({
    table_name: "party_permissions",
    row_id: rowId,
    action: "update",
    changed_by: caller.partyId,
    auth_user_id: caller.authUserId,
    new_row: { intent, by_name: caller.name, ...detail },
  });
}

Deno.serve((req) => handle(req, async () => {
  // Identity comes from the token and from nowhere else.
  const me = await authenticate(req);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action as string | undefined;
  if (!action) return json({ error: "No action was given." }, 400);

  // If an old screen still sends requester_id, it is scenery. Say so in the
  // logs so anybody watching can see it being ignored rather than honoured.
  if (body.requester_id) {
    console.warn(
      `permissions-actions: ignoring requester_id in body; acting as token holder ${me.partyId}`,
    );
  }

  // ---------------------------------------------------------------
  // get_my_permissions — what am I allowed to do? Any signed-in user.
  // The app usually gets this from `me` now; kept working for old screens.
  // ---------------------------------------------------------------
  if (action === "get_my_permissions") {
    return json({
      success: true,
      is_owner: me.isOwner,
      party_id: me.partyId,
      name: me.name,
      permission_keys: me.permissions,
    }, 200);
  }

  // Everything below changes or exposes who may do what.
  requirePermission(me, MANAGE);

  // ---------------------------------------------------------------
  // get_permissions_data — the catalogue, the roster and every grant.
  // ---------------------------------------------------------------
  if (action === "get_permissions_data") {
    const [permsRes, staffRes, grantsRes, rolesRes, accountsRes] = await Promise.all([
      me.admin.from("permissions").select("*").eq("status", "approved")
        .order("sort_order", { ascending: true }),
      me.admin.from("employee_details")
        .select(
          "party_id, employment_state, status, " +
            "departments(name), designations(name), " +
            "parties!employee_details_party_id_fkey(display_name, party_number, status, primary_email, primary_mobile)",
        ),
      me.admin.from("party_permissions")
        .select("party_id, permission_id, status, granted_by, updated_at"),
      me.admin.from("party_roles").select("party_id, role").eq("status", "approved"),
      me.admin.from("user_accounts").select("party_id, login_email, is_locked, status"),
    ]);
    for (const r of [permsRes, staffRes, grantsRes, rolesRes, accountsRes]) {
      if (r.error) throw r.error;
    }

    const rolesByParty = new Map<string, string[]>();
    for (const r of rolesRes.data ?? []) {
      const list = rolesByParty.get(r.party_id) ?? [];
      list.push(r.role);
      rolesByParty.set(r.party_id, list);
    }
    const accountByParty = new Map<string, { login_email: string; is_locked: boolean; status: string }>();
    for (const a of accountsRes.data ?? []) accountByParty.set(a.party_id, a);

    type StaffRow = {
      party_id: string;
      employment_state: string;
      status: string;
      departments: { name: string } | null;
      designations: { name: string } | null;
      parties: {
        display_name: string;
        party_number: string | null;
        status: string;
        primary_email: string | null;
        primary_mobile: string | null;
      } | null;
    };

    const employees = ((staffRes.data ?? []) as unknown as StaffRow[])
      .filter((e) => e.parties && e.parties.status !== "cancelled")
      .map((e) => {
        const roles = rolesByParty.get(e.party_id) ?? [];
        const account = accountByParty.get(e.party_id);
        return {
          party_id: e.party_id,
          id: e.party_id,                       // the old screen's key
          party_number: e.parties!.party_number,
          name: e.parties!.display_name,
          department: e.departments?.name ?? null,
          designation: e.designations?.name ?? null,
          employment_state: e.employment_state,
          roles,
          is_owner: roles.includes("owner"),
          email: account?.login_email ?? e.parties!.primary_email ?? null,
          mobile: e.parties!.primary_mobile,
          has_login: Boolean(account),
          login_locked: account?.is_locked ?? false,
          status: e.parties!.status,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const history = (grantsRes.data ?? []).map((g) => ({
      party_id: g.party_id,
      employee_id: g.party_id,                  // the old screen's key
      permission_id: g.permission_id,
      status: g.status,
      granted_by: g.granted_by,
      updated_at: g.updated_at,
    }));

    return json({
      success: true,
      permissions: permsRes.data,
      employees,
      // What is in force now — what the tick boxes should show.
      grants: history.filter((g) => g.status === "approved"),
      // Every row ever written, cancelled ones included. Nothing is deleted.
      grant_history: history,
    }, 200);
  }

  // ---------------------------------------------------------------
  // grant_permission — add one, or bring a cancelled one back.
  // ---------------------------------------------------------------
  if (action === "grant_permission") {
    const partyId = targetPartyId(body);
    const target = await loadTarget(me, partyId);
    refuseIfOwner(target);
    const perm = await findPermission(me, body);

    const { data: existing } = await me.admin
      .from("party_permissions")
      .select("id, status")
      .eq("party_id", partyId)
      .eq("permission_id", perm.id)
      .maybeSingle();

    let rowId: string | null = existing?.id ?? null;
    if (existing) {
      // Re-approve the row that is already there rather than making a new one,
      // so the history of this grant stays in one place.
      const { error } = await me.admin
        .from("party_permissions")
        .update({ status: "approved", granted_by: me.partyId })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { data: inserted, error } = await me.admin
        .from("party_permissions")
        .insert({
          party_id: partyId,
          permission_id: perm.id,
          granted_by: me.partyId,
          created_by: me.partyId,
          status: "approved",
        })
        .select("id")
        .single();
      if (error) throw error;
      rowId = inserted.id;
    }

    await noteInAudit(me, rowId, "grant", {
      party_id: partyId, permission_key: perm.key, granted_by: me.partyId,
    });

    return json({
      success: true,
      message: `${perm.label} granted to ${target.display_name}.`,
      party_id: partyId,
      permission_id: perm.id,
    }, 200);
  }

  // ---------------------------------------------------------------
  // revoke_permission — cancel it. The row stays.
  // ---------------------------------------------------------------
  if (action === "revoke_permission") {
    const partyId = targetPartyId(body);
    const target = await loadTarget(me, partyId);
    refuseIfOwner(target);
    const perm = await findPermission(me, body);
    refuseSelfDemotion(me, partyId, perm.key);

    const { data: existing } = await me.admin
      .from("party_permissions")
      .select("id, status")
      .eq("party_id", partyId)
      .eq("permission_id", perm.id)
      .maybeSingle();

    if (!existing) {
      return json({
        success: true,
        message: `${target.display_name} did not have ${perm.label}. Nothing to change.`,
      }, 200);
    }
    if (existing.status !== "cancelled") {
      const { error } = await me.admin
        .from("party_permissions")
        .update({ status: "cancelled" })
        .eq("id", existing.id);
      if (error) throw error;
    }

    await noteInAudit(me, existing.id, "revoke", {
      party_id: partyId, permission_key: perm.key, cancelled_by: me.partyId,
    });

    return json({
      success: true,
      message: `${perm.label} taken away from ${target.display_name}. The record of it is kept.`,
      party_id: partyId,
      permission_id: perm.id,
    }, 200);
  }

  // ---------------------------------------------------------------
  // bulk_set_permissions — make one person's list match what was sent.
  // Cancels what is no longer wanted, adds or re-approves what is.
  // It never deletes, which is what the Tokyo version did.
  // ---------------------------------------------------------------
  if (action === "bulk_set_permissions") {
    const partyId = targetPartyId(body);
    const wanted = body.permission_ids;
    if (!Array.isArray(wanted)) {
      return json({ error: "permission_ids must be a list, even an empty one." }, 400);
    }
    const target = await loadTarget(me, partyId);
    refuseIfOwner(target);

    const wantedIds = [...new Set(wanted.filter((x): x is string => typeof x === "string"))];

    const { data: catalogue, error: catErr } = await me.admin
      .from("permissions").select("id, key, label").eq("status", "approved");
    if (catErr) throw catErr;
    const byId = new Map((catalogue ?? []).map((p) => [p.id as string, p]));

    const unknown = wantedIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      return json({ error: `Those are not permissions I know: ${unknown.join(", ")}` }, 400);
    }

    const { data: existingRows, error: exErr } = await me.admin
      .from("party_permissions")
      .select("id, permission_id, status")
      .eq("party_id", partyId);
    if (exErr) throw exErr;

    const existing = new Map((existingRows ?? []).map((r) => [r.permission_id as string, r]));
    const wantedSet = new Set(wantedIds);

    // Guard before touching anything, so a refusal changes nothing at all.
    for (const [permId, row] of existing) {
      if (row.status === "approved" && !wantedSet.has(permId)) {
        refuseSelfDemotion(me, partyId, byId.get(permId)?.key ?? "");
      }
    }

    const toCancel = [...existing.values()]
      .filter((r) => r.status !== "cancelled" && !wantedSet.has(r.permission_id));
    const toReapprove = wantedIds
      .map((id) => existing.get(id))
      .filter((r): r is { id: string; permission_id: string; status: string } =>
        Boolean(r) && r!.status !== "approved");
    const toInsert = wantedIds.filter((id) => !existing.has(id));

    if (toCancel.length > 0) {
      const { error } = await me.admin
        .from("party_permissions")
        .update({ status: "cancelled" })
        .in("id", toCancel.map((r) => r.id));
      if (error) throw error;
    }
    if (toReapprove.length > 0) {
      const { error } = await me.admin
        .from("party_permissions")
        .update({ status: "approved", granted_by: me.partyId })
        .in("id", toReapprove.map((r) => r.id));
      if (error) throw error;
    }
    if (toInsert.length > 0) {
      const { error } = await me.admin.from("party_permissions").insert(
        toInsert.map((permission_id) => ({
          party_id: partyId,
          permission_id,
          granted_by: me.partyId,
          created_by: me.partyId,
          status: "approved",
        })),
      );
      if (error) throw error;
    }

    await noteInAudit(me, null, "bulk_set", {
      party_id: partyId,
      set_by: me.partyId,
      granted: [...toReapprove.map((r) => r.permission_id), ...toInsert],
      cancelled: toCancel.map((r) => r.permission_id),
    });

    return json({
      success: true,
      message:
        `${target.display_name} now has ${wantedIds.length} permission${wantedIds.length === 1 ? "" : "s"}. ` +
        `${toCancel.length} taken away, ${toReapprove.length + toInsert.length} added. ` +
        `Nothing was deleted.`,
      party_id: partyId,
      granted: toReapprove.length + toInsert.length,
      cancelled: toCancel.length,
      unchanged: wantedIds.length - (toReapprove.length + toInsert.length),
    }, 200);
  }

  // ---------------------------------------------------------------
  // set_login_mode — retired.
  // Single or multiple sessions was our own bookkeeping in the
  // employee_sessions table. Supabase Auth owns sessions now, so there
  // is nothing here to set. Answered plainly rather than quietly.
  // ---------------------------------------------------------------
  if (action === "set_login_mode") {
    return json({
      success: false,
      retired: true,
      error:
        "Single and multiple login mode no longer exists. Sessions are handled by Supabase Auth, " +
        "which manages sign-ins and sign-outs on its own. To stop somebody signing in, " +
        "lock their account on the Users screen instead.",
    }, 400);
  }

  return json({ error: `I do not know the action "${action}".` }, 400);
}));
