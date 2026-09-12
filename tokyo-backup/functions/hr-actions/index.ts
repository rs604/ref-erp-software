import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

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

async function hasPermission(supabase: any, employeeId: string, key: string): Promise<boolean> {
  const { data: perm } = await supabase.from("permissions").select("id").eq("key", key).maybeSingle();
  if (!perm) return false;
  const { data: grant } = await supabase.from("employee_permissions").select("id").eq("employee_id", employeeId).eq("permission_id", perm.id).maybeSingle();
  return !!grant;
}

const DROPDOWN_TABLES: Record<string, string> = {
  branches: "branches",
  departments: "departments",
  designations: "designations",
  employee_categories: "employee_categories",
  relationships: "relationships",
  asset_types: "asset_types",
};

const ALLOWED_ERP_DOMAINS = ["refconveyors.com", "refconveyors.net"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { action, requester_id } = body;

    if (!action || !requester_id) {
      return jsonResponse({ error: "Missing action or requester_id" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: requester, error: reqErr } = await supabase
      .from("employees")
      .select("id, name, role, status")
      .eq("id", requester_id)
      .maybeSingle();

    if (reqErr) throw reqErr;
    if (!requester || requester.status !== "active") {
      return jsonResponse({ error: "Not authorized" }, 403);
    }

    // ---------------- REQUEST ERP ACCESS (anyone with employee_master.create, or Owner) ----------------
    // Creates a PENDING request, does not grant access. The Owner must approve it from the Home tab.
    if (action === "request_employee_erp_access") {
      const allowed = requester.role === "owner" || await hasPermission(supabase, requester_id, "employee_master.create");
      if (!allowed) return jsonResponse({ error: "You don't have permission to request ERP access for employees" }, 403);

      const { employee_id, email } = body;
      if (!employee_id || !email) return jsonResponse({ error: "Missing employee_id or email" }, 400);
      const normalizedEmail = email.toLowerCase().trim();
      const domain = normalizedEmail.split("@")[1];
      if (!ALLOWED_ERP_DOMAINS.includes(domain)) {
        return jsonResponse({ error: "Email must be @refconveyors.com or @refconveyors.net" }, 400);
      }

      const { data: existingEmail } = await supabase.from("employees").select("id").eq("email", normalizedEmail).neq("id", employee_id).maybeSingle();
      if (existingEmail) return jsonResponse({ error: "This email is already used by another employee" }, 409);

      const { data: existingPending } = await supabase.from("erp_login_requests").select("id").eq("employee_id", employee_id).eq("status", "pending").maybeSingle();
      if (existingPending) return jsonResponse({ error: "A pending request already exists for this employee" }, 409);

      const { error } = await supabase.from("erp_login_requests").insert({ employee_id, requested_by: requester_id, requested_email: normalizedEmail });
      if (error) throw error;
      return jsonResponse({ success: true, message: "Request submitted — waiting for Owner approval." }, 200);
    }

    // ---------------- REVOKE ERP ACCESS (Owner, or employee_master.edit — revoking is lower-risk than granting) ----------------
    if (action === "revoke_employee_erp_access") {
      const allowed = requester.role === "owner" || await hasPermission(supabase, requester_id, "employee_master.edit");
      if (!allowed) return jsonResponse({ error: "You don't have permission to revoke ERP access" }, 403);
      const { employee_id } = body;
      if (!employee_id) return jsonResponse({ error: "Missing employee_id" }, 400);
      const { error } = await supabase.from("employees").update({ erp_login_enabled: false }).eq("id", employee_id);
      if (error) throw error;
      await supabase.from("employee_sessions").delete().eq("employee_id", employee_id);
      return jsonResponse({ success: true }, 200);
    }

    // ---------------- GET PENDING ERP REQUESTS (Owner only — this is the Home tab / HRMS Approvals feed) ----------------
    if (action === "get_pending_erp_requests") {
      if (requester.role !== "owner") return jsonResponse({ error: "Only the Owner can view pending approvals" }, 403);
      const { data: requestRows, error } = await supabase.from("erp_login_requests").select("*").eq("status", "pending").order("created_at");
      if (error) throw error;
      const employeeIds = [...new Set([...(requestRows || []).map((r: any) => r.employee_id), ...(requestRows || []).map((r: any) => r.requested_by)])];
      const { data: namesData } = employeeIds.length > 0
        ? await supabase.from("employees").select("id, name, employee_code, departments(name)").in("id", employeeIds)
        : { data: [] };
      const nameMap: Record<string, any> = {};
      (namesData || []).forEach((e: any) => { nameMap[e.id] = e; });
      const enriched = (requestRows || []).map((r: any) => ({
        ...r,
        employee: nameMap[r.employee_id] || null,
        requester: nameMap[r.requested_by] || null,
      }));
      return jsonResponse({ success: true, requests: enriched }, 200);
    }

    // ---------------- GET MY ERP REQUESTS (anyone — lets the requester see status + temp password once approved) ----------------
    if (action === "get_my_erp_requests") {
      const { data: requestRows, error } = await supabase.from("erp_login_requests").select("*").eq("requested_by", requester_id).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      const employeeIds = [...new Set((requestRows || []).map((r: any) => r.employee_id))];
      const { data: namesData } = employeeIds.length > 0
        ? await supabase.from("employees").select("id, name, employee_code").in("id", employeeIds)
        : { data: [] };
      const nameMap: Record<string, any> = {};
      (namesData || []).forEach((e: any) => { nameMap[e.id] = e; });
      const enriched = (requestRows || []).map((r: any) => ({ ...r, employee: nameMap[r.employee_id] || null }));
      // Mark any approved-and-viewed-for-the-first-time requests as viewed, so the password isn't shown as "new" again
      const toMarkViewed = (requestRows || []).filter((r: any) => r.status === "approved" && !r.temp_password_viewed).map((r: any) => r.id);
      if (toMarkViewed.length > 0) {
        await supabase.from("erp_login_requests").update({ temp_password_viewed: true }).in("id", toMarkViewed);
      }
      return jsonResponse({ success: true, requests: enriched }, 200);
    }

    // ---------------- APPROVE ERP LOGIN REQUEST (Owner only) ----------------
    if (action === "approve_erp_login_request") {
      if (requester.role !== "owner") return jsonResponse({ error: "Only the Owner can approve ERP access requests" }, 403);
      const { request_id } = body;
      if (!request_id) return jsonResponse({ error: "Missing request_id" }, 400);

      const { data: reqRow, error: reqRowErr } = await supabase.from("erp_login_requests").select("*").eq("id", request_id).eq("status", "pending").maybeSingle();
      if (reqRowErr) throw reqRowErr;
      if (!reqRow) return jsonResponse({ error: "This request is no longer pending" }, 400);

      const { data: existingEmail } = await supabase.from("employees").select("id").eq("email", reqRow.requested_email).neq("id", reqRow.employee_id).maybeSingle();
      if (existingEmail) return jsonResponse({ error: "This email is now used by another employee — ask the requester to submit a new request." }, 409);

      const tempPassword = "Ref" + Math.floor(1000 + Math.random() * 9000) + "!";
      const hash = await bcrypt.hash(tempPassword, 10);

      const { error: empErr } = await supabase.from("employees").update({
        email: reqRow.requested_email, erp_login_enabled: true, password_hash: hash, must_change_password: true,
      }).eq("id", reqRow.employee_id);
      if (empErr) throw empErr;

      const { error: reqUpdErr } = await supabase.from("erp_login_requests").update({
        status: "approved", temp_password: tempPassword, temp_password_viewed: false,
        resolved_at: new Date().toISOString(), resolved_by: requester_id,
      }).eq("id", request_id);
      if (reqUpdErr) throw reqUpdErr;

      return jsonResponse({ success: true }, 200);
    }

    // ---------------- REJECT ERP LOGIN REQUEST (Owner only) ----------------
    if (action === "reject_erp_login_request") {
      if (requester.role !== "owner") return jsonResponse({ error: "Only the Owner can reject ERP access requests" }, 403);
      const { request_id, reason } = body;
      if (!request_id) return jsonResponse({ error: "Missing request_id" }, 400);
      if (!reason?.trim()) return jsonResponse({ error: "A reason is required" }, 400);
      const { error } = await supabase.from("erp_login_requests").update({
        status: "rejected", rejection_reason: reason.trim(), resolved_at: new Date().toISOString(), resolved_by: requester_id,
      }).eq("id", request_id).eq("status", "pending");
      if (error) throw error;
      return jsonResponse({ success: true }, 200);
    }

    if (!["admin", "owner"].includes(requester.role)) {
      return jsonResponse({ error: "Only admin or owner can perform this action" }, 403);
    }

    if (action === "get_dropdowns") {
      const tableNames = Object.values(DROPDOWN_TABLES);
      const [tableResults, statesRes, citiesRes] = await Promise.all([
        Promise.all(tableNames.map((table) => supabase.from(table).select("*").order("name", { ascending: true }))),
        supabase.from("states").select("*").order("name"),
        supabase.from("cities").select("*").order("name"),
      ]);

      const results: Record<string, any> = {};
      tableNames.forEach((table, idx) => {
        if (tableResults[idx].error) throw tableResults[idx].error;
        results[table] = tableResults[idx].data;
      });
      if (statesRes.error) throw statesRes.error;
      if (citiesRes.error) throw citiesRes.error;
      results.states = statesRes.data;
      results.cities = citiesRes.data;

      return jsonResponse({ success: true, dropdowns: results }, 200);
    }

    if (action === "add_dropdown_item") {
      const { table, fields } = body;
      if (!table || !DROPDOWN_TABLES[table]) return jsonResponse({ error: "Invalid table" }, 400);
      if (!fields || !fields.name) return jsonResponse({ error: "Name is required" }, 400);

      const insertData: Record<string, any> = { name: fields.name };
      if (table === "cities") {
        if (!fields.state_id) return jsonResponse({ error: "State is required for a city" }, 400);
        insertData.state_id = fields.state_id;
      }

      const { data, error } = await supabase.from(table).insert(insertData).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, item: data }, 200);
    }

    if (action === "rename_dropdown_item") {
      const { table, id, new_name } = body;
      if (!table || !DROPDOWN_TABLES[table] || !id) return jsonResponse({ error: "Missing table or id" }, 400);
      if (!new_name || !new_name.trim()) return jsonResponse({ error: "Name is required" }, 400);
      const { data, error } = await supabase.from(table).update({ name: new_name.trim() }).eq("id", id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, item: data }, 200);
    }

    if (action === "delete_dropdown_item") {
      const { table, id } = body;
      if (!table || !DROPDOWN_TABLES[table] || !id) return jsonResponse({ error: "Missing table or id" }, 400);
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) {
        if (error.code === "23503") {
          return jsonResponse({ error: "This item is currently assigned to one or more employees and cannot be deleted. Deactivate it instead." }, 400);
        }
        throw error;
      }
      return jsonResponse({ success: true }, 200);
    }

    if (action === "toggle_dropdown_item") {
      const { table, id, is_active } = body;
      if (!table || !DROPDOWN_TABLES[table] || !id) return jsonResponse({ error: "Missing table or id" }, 400);
      const { data, error } = await supabase.from(table).update({ is_active }).eq("id", id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, item: data }, 200);
    }

    if (action === "get_employee_list") {
      const { data, error } = await supabase
        .from("employees")
        .select(`
          id, employee_code, name, mobile_number, role, status, photo_url,
          date_of_joining, wage_type, rate_per_km, vehicle_km_applicable, assigned_vehicle_id,
          email, erp_login_enabled, login_mode,
          branches(name), departments(name), designations(name), employee_categories(name)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return jsonResponse({ success: true, employees: data }, 200);
    }

    if (action === "upload_document") {
      const { employee_id, slot, file_base64, file_ext, document_name } = body;
      if (!employee_id || !slot || !file_base64) {
        return jsonResponse({ error: "Missing employee_id, slot, or file" }, 400);
      }

      const base64Data = file_base64.includes(",") ? file_base64.split(",")[1] : file_base64;
      const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
      const ext = file_ext || "jpg";
      const contentType = ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`;

      if (slot === "photo") {
        const path = `${employee_id}/photo.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("employee-documents")
          .upload(path, binaryData, { contentType, upsert: true });
        if (uploadErr) return jsonResponse({ error: "Upload failed: " + uploadErr.message }, 500);

        const { data: updated, error: updateErr } = await supabase
          .from("employees")
          .update({ photo_url: path })
          .eq("id", employee_id)
          .select("id, photo_url")
          .single();
        if (updateErr) throw updateErr;
        return jsonResponse({ success: true, photo_url: path }, 200);
      }

      if (slot !== "other") {
        const { data: existing } = await supabase
          .from("employee_documents")
          .select("id, file_url")
          .eq("employee_id", employee_id)
          .eq("slot", slot)
          .maybeSingle();
        if (existing) {
          await supabase.storage.from("employee-documents").remove([existing.file_url]);
          await supabase.from("employee_documents").delete().eq("id", existing.id);
        }
      }

      const path = `${employee_id}/${slot}_${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("employee-documents")
        .upload(path, binaryData, { contentType, upsert: true });
      if (uploadErr) return jsonResponse({ error: "Upload failed: " + uploadErr.message }, 500);

      const { data: docRow, error: insertErr } = await supabase
        .from("employee_documents")
        .insert({
          employee_id,
          slot,
          document_name: document_name || slot,
          file_url: path,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      return jsonResponse({ success: true, document: docRow }, 200);
    }

    if (action === "delete_document") {
      const { document_id } = body;
      if (!document_id) return jsonResponse({ error: "Missing document_id" }, 400);

      const { data: doc, error: fetchErr } = await supabase
        .from("employee_documents")
        .select("file_url")
        .eq("id", document_id)
        .single();
      if (fetchErr) throw fetchErr;

      await supabase.storage.from("employee-documents").remove([doc.file_url]);
      const { error: delErr } = await supabase.from("employee_documents").delete().eq("id", document_id);
      if (delErr) throw delErr;

      return jsonResponse({ success: true }, 200);
    }

    if (action === "get_employee_detail") {
      const { employee_id } = body;
      if (!employee_id) return jsonResponse({ error: "Missing employee_id" }, 400);

      const { data: employee, error: empErr } = await supabase
        .from("employees")
        .select("*")
        .eq("id", employee_id)
        .single();
      if (empErr) throw empErr;

      if (employee.photo_url) {
        const { data: signed } = await supabase.storage.from("employee-documents").createSignedUrl(employee.photo_url, 3600);
        employee.photo_signed_url = signed?.signedUrl || null;
      }

      const [family, education, workExp, nominees, assets, documents] = await Promise.all([
        supabase.from("employee_family_members").select("*, relationships(name)").eq("employee_id", employee_id),
        supabase.from("employee_education").select("*").eq("employee_id", employee_id),
        supabase.from("employee_work_experience").select("*").eq("employee_id", employee_id),
        supabase.from("employee_nominees").select("*").eq("employee_id", employee_id),
        supabase.from("employee_assets").select("*, asset_types(name)").eq("employee_id", employee_id),
        supabase.from("employee_documents").select("*").eq("employee_id", employee_id),
      ]);

      const documentsWithUrls = await Promise.all(
        (documents.data || []).map(async (doc: any) => {
          const { data: signed } = await supabase.storage.from("employee-documents").createSignedUrl(doc.file_url, 3600);
          return { ...doc, signed_url: signed?.signedUrl || null };
        })
      );

      return jsonResponse({
        success: true,
        employee,
        family: family.data || [],
        education: education.data || [],
        workExperience: workExp.data || [],
        nominees: nominees.data || [],
        assets: assets.data || [],
        documents: documentsWithUrls,
      }, 200);
    }

    if (action === "create_employee") {
      const { core, pin } = body;
      if (!core?.name || !core?.mobile_number) {
        return jsonResponse({ error: "Name and mobile number are required" }, 400);
      }
      if (!core?.employee_code) {
        return jsonResponse({ error: "Employee Code is required" }, 400);
      }

      const effectivePin = pin && pin.trim() ? pin.trim() : core.mobile_number.slice(-4);
      const hashedPin = await bcrypt.hash(effectivePin, 10);

      let assignedVehicleId = null;
      if (core.vehicle_km_applicable && core.vehicle_number) {
        const { data: newVehicle, error: vehErr } = await supabase
          .from("vehicles")
          .insert({
            vehicle_name: core.vehicle_number,
            ownership_type: "employee",
            is_active: true,
          })
          .select()
          .single();
        if (vehErr) throw vehErr;
        assignedVehicleId = newVehicle.id;
      }

      const insertPayload = {
        ...core,
        pin: hashedPin,
        status: "active",
        role: core.role || "employee",
        assigned_vehicle_id: assignedVehicleId,
      };
      delete insertPayload.vehicle_number;

      const { data: newEmp, error: insertErr } = await supabase
        .from("employees")
        .insert(insertPayload)
        .select()
        .single();

      if (insertErr) {
        if (insertErr.message?.includes("duplicate")) {
          return jsonResponse({ error: "This mobile number or employee code is already registered" }, 409);
        }
        throw insertErr;
      }

      if (assignedVehicleId) {
        await supabase.from("vehicles").update({ owner_employee_id: newEmp.id }).eq("id", assignedVehicleId);
      }

      return jsonResponse({ success: true, employee: newEmp, generatedPin: pin && pin.trim() ? null : effectivePin }, 200);
    }

    if (action === "reset_pin") {
      const { employee_id, new_pin } = body;
      if (!employee_id || !new_pin || new_pin.trim().length < 4) {
        return jsonResponse({ error: "A PIN of at least 4 digits is required" }, 400);
      }
      const hashedPin = await bcrypt.hash(new_pin.trim(), 10);
      const { data: updated, error: updateErr } = await supabase
        .from("employees")
        .update({ pin: hashedPin })
        .eq("id", employee_id)
        .select("id, name")
        .single();
      if (updateErr) throw updateErr;
      return jsonResponse({ success: true, employee: updated }, 200);
    }

    if (action === "update_employee") {
      const { employee_id, core } = body;
      if (!employee_id || !core) return jsonResponse({ error: "Missing employee_id or core data" }, 400);

      const updatePayload = { ...core };
      delete updatePayload.vehicle_number;
      delete updatePayload.pin;

      if (core.vehicle_km_applicable && core.vehicle_number) {
        const { data: existingEmp } = await supabase
          .from("employees")
          .select("assigned_vehicle_id")
          .eq("id", employee_id)
          .single();

        if (existingEmp?.assigned_vehicle_id) {
          await supabase.from("vehicles").update({ vehicle_name: core.vehicle_number }).eq("id", existingEmp.assigned_vehicle_id);
        } else {
          const { data: newVehicle, error: vehErr } = await supabase
            .from("vehicles")
            .insert({ vehicle_name: core.vehicle_number, ownership_type: "employee", owner_employee_id: employee_id, is_active: true })
            .select()
            .single();
          if (vehErr) throw vehErr;
          updatePayload.assigned_vehicle_id = newVehicle.id;
        }
      } else if (core.vehicle_km_applicable === false) {
        updatePayload.assigned_vehicle_id = null;
      }

      const { data: updated, error: updateErr } = await supabase
        .from("employees")
        .update(updatePayload)
        .eq("id", employee_id)
        .select()
        .single();
      if (updateErr) throw updateErr;

      return jsonResponse({ success: true, employee: updated }, 200);
    }

    if (action === "update_employee_status") {
      const { employee_id, new_status } = body;
      if (!employee_id || !["active", "suspended", "left"].includes(new_status)) {
        return jsonResponse({ error: "Invalid employee_id or status" }, 400);
      }

      const { data: updated, error: updateErr } = await supabase
        .from("employees")
        .update({ status: new_status })
        .eq("id", employee_id)
        .select("id, name, status")
        .single();
      if (updateErr) throw updateErr;

      return jsonResponse({ success: true, employee: updated }, 200);
    }

    if (action === "save_child_records") {
      const { employee_id, table, records } = body;
      const allowedTables = ["employee_family_members", "employee_education", "employee_work_experience", "employee_nominees", "employee_assets"];
      if (!employee_id || !allowedTables.includes(table) || !Array.isArray(records)) {
        return jsonResponse({ error: "Invalid request" }, 400);
      }

      const { error: delErr } = await supabase.from(table).delete().eq("employee_id", employee_id);
      if (delErr) throw delErr;

      if (records.length > 0) {
        const rowsToInsert = records.map((r: any) => ({ ...r, employee_id }));
        const { error: insErr } = await supabase.from(table).insert(rowsToInsert);
        if (insErr) throw insErr;
      }

      return jsonResponse({ success: true }, 200);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
