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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function hasPermission(supabase: any, employeeId: string, role: string, key: string): Promise<boolean> {
  if (role === "owner") return true;
  const { data: perm } = await supabase.from("permissions").select("id").eq("key", key).maybeSingle();
  if (!perm) return false;
  const { data: grant } = await supabase.from("employee_permissions").select("id").eq("employee_id", employeeId).eq("permission_id", perm.id).maybeSingle();
  return !!grant;
}

const MOBILE_RE = /^[6-9][0-9]{9}$/;
const PINCODE_RE = /^[1-9][0-9]{5}$/;
const IFSC_RE = /^[A-Z]{4}0[0-9A-Z]{6}$/;
const AADHAR_RE = /^[0-9]{12}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

async function resolveContact(supabase: any, branchOrVendorTarget: { branch_id?: string; vendor_id?: string }, contactInput: any) {
  // contactInput: { reuse_contact_id } OR { name, mobile, other_no, email, other_email, designation }
  let contactId: string;
  if (contactInput.reuse_contact_id) {
    contactId = contactInput.reuse_contact_id;
  } else {
    if (!contactInput.name || !contactInput.mobile) throw new Error("Contact Name and Mobile are required");
    if (!MOBILE_RE.test(contactInput.mobile)) throw new Error("Invalid contact mobile number");
    const { data: existing } = await supabase.from("vendor_contacts").select("id").eq("mobile", contactInput.mobile).maybeSingle();
    if (existing) {
      contactId = existing.id;
    } else {
      const { data: newContact, error } = await supabase.from("vendor_contacts").insert({
        name: contactInput.name, mobile: contactInput.mobile,
        other_no: contactInput.other_no || null, email: contactInput.email || null, other_email: contactInput.other_email || null,
      }).select().single();
      if (error) throw error;
      contactId = newContact.id;
    }
  }
  const { error: linkErr } = await supabase.from("vendor_contact_branch_links").insert({
    contact_id: contactId,
    branch_id: branchOrVendorTarget.branch_id || null,
    vendor_id: branchOrVendorTarget.vendor_id || null,
    designation: contactInput.designation || null,
  });
  if (linkErr) throw linkErr;
  return contactId;
}

async function resolveBankAccount(supabase: any, vendorId: string, branchId: string, bankInput: any) {
  // bankInput: { reuse_bank_account_id } OR { bank_name, account_number, ifsc, branch, holder_name }
  if (bankInput.reuse_bank_account_id) {
    const { data: src, error } = await supabase.from("vendor_bank_accounts").select("*").eq("id", bankInput.reuse_bank_account_id).single();
    if (error) throw error;
    const { error: insErr } = await supabase.from("vendor_bank_accounts").insert({
      vendor_id: vendorId, branch_id: branchId,
      account_holder_name: src.account_holder_name, bank_name: src.bank_name,
      account_number: src.account_number, ifsc: src.ifsc, branch: src.branch, is_primary: false,
    });
    if (insErr) throw insErr;
    return;
  }
  if (!bankInput.bank_name || !bankInput.account_number || !bankInput.ifsc) throw new Error("Bank Name, Account Number, and IFSC are required");
  if (!IFSC_RE.test(bankInput.ifsc.toUpperCase())) throw new Error(`Invalid IFSC format for bank "${bankInput.bank_name}"`);
  const { error: insErr } = await supabase.from("vendor_bank_accounts").insert({
    vendor_id: vendorId, branch_id: branchId,
    account_holder_name: bankInput.holder_name || null, bank_name: bankInput.bank_name,
    account_number: bankInput.account_number, ifsc: bankInput.ifsc.toUpperCase(), branch: bankInput.branch || null, is_primary: true,
  });
  if (insErr) throw insErr;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { action, requester_id } = body;
    if (!action || !requester_id) return jsonResponse({ error: "Missing action or requester_id" }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: requester, error: reqErr } = await supabase.from("employees").select("id, role, status").eq("id", requester_id).maybeSingle();
    if (reqErr) throw reqErr;
    if (!requester || requester.status !== "active") return jsonResponse({ error: "Not authorized" }, 403);

    // ---------------- DROPDOWNS ----------------
    if (action === "get_vendor_dropdowns") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.view"))) return jsonResponse({ error: "You don't have permission to view Vendor Master" }, 403);
      const [stateRes, cityRes] = await Promise.all([
        supabase.from("states").select("*").order("name"),
        supabase.from("cities").select("*").order("name"),
      ]);
      if (stateRes.error) throw stateRes.error;
      if (cityRes.error) throw cityRes.error;
      return jsonResponse({ success: true, states: stateRes.data, cities: cityRes.data }, 200);
    }

    // ---------------- LIST ----------------
    if (action === "get_vendor_list") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.view"))) return jsonResponse({ error: "You don't have permission to view Vendor Master" }, 403);
      const { data, error } = await supabase
        .from("vendors")
        .select("id, vendor_code, vendor_name, vendor_alias, vendor_type, status, blacklist_status, pan, aadhar_number, deals_in, primary_contact_name, primary_contact_mobile, is_test_entry")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return jsonResponse({ success: true, vendors: data }, 200);
    }

    // ---------------- DETAIL (vendor + all branches, each with bank accounts + contacts, + relationships) ----------------
    if (action === "get_vendor_detail") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.view"))) return jsonResponse({ error: "You don't have permission to view Vendor Master" }, 403);
      const { vendor_id } = body;
      if (!vendor_id) return jsonResponse({ error: "Missing vendor_id" }, 400);

      const { data: vendor, error: vErr } = await supabase.from("vendors").select("*").eq("id", vendor_id).single();
      if (vErr) throw vErr;

      // Branches are fetched first (not in the batch below) because the contact-links query needs their IDs —
      // previously this was done as a SEPARATE redundant query nested inside the Promise.all itself, doubling
      // the branch fetch and blocking the whole batch on an extra sequential round-trip for no reason.
      const branchRes = await supabase.from("vendor_branches").select("*, states(name), cities(name)").eq("vendor_id", vendor_id).order("created_at");
      if (branchRes.error) throw branchRes.error;
      const branchIds = (branchRes.data || []).map((b: any) => b.id);

      const [bankRes, docRes, linkRes, relARes, relBRes] = await Promise.all([
        supabase.from("vendor_bank_accounts").select("*").eq("vendor_id", vendor_id).eq("is_active", true),
        supabase.from("vendor_documents").select("*").eq("vendor_id", vendor_id),
        branchIds.length > 0
          ? supabase.from("vendor_contact_branch_links").select("*, vendor_contacts(*)").in("branch_id", branchIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("vendor_relationships").select("id, vendor_id_b, vendors:vendor_id_b(id, vendor_code, vendor_name)").eq("vendor_id_a", vendor_id),
        supabase.from("vendor_relationships").select("id, vendor_id_a, vendors:vendor_id_a(id, vendor_code, vendor_name)").eq("vendor_id_b", vendor_id),
      ]);
      if (bankRes.error) throw bankRes.error;
      if (docRes.error) throw docRes.error;

      const documentsWithUrls = await Promise.all((docRes.data || []).map(async (doc: any) => {
        const { data: signed } = await supabase.storage.from("vendor-documents").createSignedUrl(doc.file_url, 3600);
        return { ...doc, signed_url: signed?.signedUrl || null };
      }));

      const relatedVendors = [
        ...(relARes.data || []).map((r: any) => r.vendors),
        ...(relBRes.data || []).map((r: any) => r.vendors),
      ];

      return jsonResponse({
        success: true, vendor,
        branches: branchRes.data, bankAccounts: bankRes.data, documents: documentsWithUrls,
        contacts: linkRes.data || [], relatedVendors,
      }, 200);
    }

    // ---------------- UPDATE VENDOR (core fields + primary branch — a genuinely complete edit, not a subset) ----------------
    if (action === "update_vendor") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.edit"))) return jsonResponse({ error: "You don't have permission to edit vendors" }, 403);
      const { vendor_id, core, branch } = body;
      if (!vendor_id) return jsonResponse({ error: "Missing vendor_id" }, 400);
      if (!core?.vendor_name) return jsonResponse({ error: "Name is required" }, 400);
      if (!core?.deals_in) return jsonResponse({ error: "Deals In is required" }, 400);
      if (!core?.primary_contact_mobile || !MOBILE_RE.test(core.primary_contact_mobile)) return jsonResponse({ error: "A valid Primary Mobile is required" }, 400);

      const { data: existing } = await supabase.from("vendors").select("vendor_type, pan, aadhar_number").eq("id", vendor_id).single();
      if (!existing) return jsonResponse({ error: "Vendor not found" }, 400);

      const updatePayload: any = {
        vendor_name: core.vendor_name,
        vendor_alias: core.vendor_alias || null,
        deals_in: core.deals_in,
        primary_contact_name: core.primary_contact_name || core.vendor_name,
        primary_contact_mobile: core.primary_contact_mobile,
        other_numbers: core.other_numbers || null,
        primary_contact_email: core.primary_contact_email || null,
        updated_at: new Date().toISOString(),
      };

      if (existing.vendor_type === "company") {
        updatePayload.is_trader = core.is_trader || false;
        updatePayload.is_manufacturer = core.is_manufacturer || false;
        updatePayload.is_exporter = core.is_exporter || false;
        updatePayload.is_service_provider = core.is_service_provider || false;
        updatePayload.msme_registered = core.msme_registered || false;
        updatePayload.msme_number = core.msme_registered ? core.msme_number : null;
        if (core.msme_registered && !core.msme_number) return jsonResponse({ error: "MSME Number is required since MSME Registered is Yes" }, 400);

        // PAN can be corrected, but re-validated exactly like at creation — format + uniqueness against every OTHER vendor
        if (core.pan) {
          const pan = core.pan.toUpperCase().trim();
          if (!PAN_RE.test(pan)) return jsonResponse({ error: "Invalid PAN format (must be AAAAA9999A)" }, 400);
          if (pan !== existing.pan) {
            const { data: dupe } = await supabase.from("vendors").select("id, vendor_code, vendor_name").eq("pan", pan).neq("id", vendor_id).maybeSingle();
            if (dupe) return jsonResponse({ error: `This PAN already belongs to vendor ${dupe.vendor_code} (${dupe.vendor_name}).` }, 409);
          }
          updatePayload.pan = pan;
        }
      } else {
        if (core.aadhar_number) {
          const aadhar = core.aadhar_number.replace(/\s/g, "");
          if (!AADHAR_RE.test(aadhar)) return jsonResponse({ error: "Invalid Aadhar Number (must be 12 digits)" }, 400);
          if (aadhar !== existing.aadhar_number) {
            const { data: dupe } = await supabase.from("vendors").select("id, vendor_code, vendor_name").eq("aadhar_number", aadhar).neq("id", vendor_id).maybeSingle();
            if (dupe) return jsonResponse({ error: `This Aadhar already belongs to vendor ${dupe.vendor_code} (${dupe.vendor_name}).` }, 409);
          }
          updatePayload.aadhar_number = aadhar;
        }
      }

      const { data: updated, error } = await supabase.from("vendors").update(updatePayload).eq("id", vendor_id).select().single();
      if (error) throw error;

      // Update the primary (first) branch's editable fields too, if provided — GST stays PAN-anchored and re-checked
      if (branch) {
        const { data: primaryBranch } = await supabase.from("vendor_branches").select("id, gstin").eq("vendor_id", vendor_id).order("created_at").limit(1).maybeSingle();
        if (primaryBranch) {
          const branchUpdate: any = {
            branch_name: branch.branch_name || undefined,
            branch_alias: branch.branch_alias ?? null,
            address: branch.address || undefined,
            state_id: branch.state_id || undefined,
            city_id: branch.city_id ?? null,
            pincode: branch.pincode ?? null,
            location_url: branch.location_url ?? null,
          };
          if (existing.vendor_type === "company" && branch.gstin) {
            const gstin = branch.gstin.toUpperCase().trim();
            if (!GSTIN_RE.test(gstin)) return jsonResponse({ error: "Invalid GSTIN format" }, 400);
            const finalPan = updatePayload.pan || existing.pan;
            const embeddedPan = gstin.substring(2, 12);
            if (embeddedPan !== finalPan) return jsonResponse({ error: `GSTIN implies PAN "${embeddedPan}" but this vendor's PAN is "${finalPan}" — please check both.` }, 400);
            if (gstin !== primaryBranch.gstin) {
              const { data: dupeGst } = await supabase.from("vendor_branches").select("id, vendor_id, vendors(vendor_code, vendor_name)").eq("gstin", gstin).neq("id", primaryBranch.id).maybeSingle();
              if (dupeGst) return jsonResponse({ error: `This GSTIN is already registered under a different vendor.` }, 409);
            }
            branchUpdate.gstin = gstin;
          }
          const { error: branchErr } = await supabase.from("vendor_branches").update(branchUpdate).eq("id", primaryBranch.id);
          if (branchErr) throw branchErr;
        }
      }

      return jsonResponse({ success: true, vendor: updated }, 200);
    }

    // ---------------- QUICK ADD BANK (adds a bank account to an existing vendor's branch) ----------------
    if (action === "quick_add_bank") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.edit"))) return jsonResponse({ error: "You don't have permission to edit vendors" }, 403);
      const { vendor_id, branch_id, bank } = body;
      if (!vendor_id || !bank?.bank_name || !bank?.account_number || !bank?.ifsc) return jsonResponse({ error: "Bank Name, Account Number, and IFSC are required" }, 400);
      if (!IFSC_RE.test(bank.ifsc.toUpperCase())) return jsonResponse({ error: "Invalid IFSC format" }, 400);
      let useBranchId = branch_id;
      if (!useBranchId) {
        const { data: firstBranch } = await supabase.from("vendor_branches").select("id").eq("vendor_id", vendor_id).order("created_at").limit(1).maybeSingle();
        useBranchId = firstBranch?.id;
      }
      if (!useBranchId) return jsonResponse({ error: "This vendor has no branch to attach a bank account to" }, 400);
      const { data: vendorRow } = await supabase.from("vendors").select("vendor_name").eq("id", vendor_id).single();
      const { error: insErr } = await supabase.from("vendor_bank_accounts").insert({
        vendor_id, branch_id: useBranchId,
        account_holder_name: vendorRow?.vendor_name || null,
        bank_name: bank.bank_name, account_number: bank.account_number, ifsc: bank.ifsc.toUpperCase(),
        is_primary: false,
      });
      if (insErr) throw insErr;
      return jsonResponse({ success: true }, 200);
    }

    // ---------------- ADD BANK ACCOUNT (full version, used from Edit form) ----------------
    if (action === "add_bank_account") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.edit"))) return jsonResponse({ error: "You don't have permission to edit vendors" }, 403);
      const { vendor_id, branch_id, bank } = body;
      if (!vendor_id || !bank?.bank_name || !bank?.account_number || !bank?.ifsc) return jsonResponse({ error: "Bank Name, Account Number, and IFSC are required" }, 400);
      if (!IFSC_RE.test(bank.ifsc.toUpperCase())) return jsonResponse({ error: "Invalid IFSC format" }, 400);
      let useBranchId = branch_id;
      if (!useBranchId) {
        const { data: firstBranch } = await supabase.from("vendor_branches").select("id").eq("vendor_id", vendor_id).order("created_at").limit(1).maybeSingle();
        useBranchId = firstBranch?.id;
      }
      if (!useBranchId) return jsonResponse({ error: "This vendor has no branch to attach a bank account to" }, 400);
      const { data: vendorRow } = await supabase.from("vendors").select("vendor_name").eq("id", vendor_id).single();
      const { data: newBank, error: insErr } = await supabase.from("vendor_bank_accounts").insert({
        vendor_id, branch_id: useBranchId,
        account_holder_name: bank.holder_name || vendorRow?.vendor_name || null,
        bank_name: bank.bank_name, account_number: bank.account_number, ifsc: bank.ifsc.toUpperCase(),
        is_primary: false,
      }).select().single();
      if (insErr) throw insErr;
      return jsonResponse({ success: true, bank: newBank }, 200);
    }

    // ---------------- UPDATE BANK ACCOUNT ----------------
    if (action === "update_bank_account") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.edit"))) return jsonResponse({ error: "You don't have permission to edit vendors" }, 403);
      const { bank_account_id, bank } = body;
      if (!bank_account_id || !bank?.bank_name || !bank?.account_number || !bank?.ifsc) return jsonResponse({ error: "Bank Name, Account Number, and IFSC are required" }, 400);
      if (!IFSC_RE.test(bank.ifsc.toUpperCase())) return jsonResponse({ error: "Invalid IFSC format" }, 400);
      const { error } = await supabase.from("vendor_bank_accounts").update({
        bank_name: bank.bank_name, account_number: bank.account_number, ifsc: bank.ifsc.toUpperCase(), branch: bank.branch || null,
      }).eq("id", bank_account_id);
      if (error) throw error;
      return jsonResponse({ success: true }, 200);
    }

    // ---------------- DEACTIVATE BANK ACCOUNT (soft-delete, never hard-deleted) ----------------
    if (action === "deactivate_bank_account") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.edit"))) return jsonResponse({ error: "You don't have permission to edit vendors" }, 403);
      const { bank_account_id, reason } = body;
      if (!bank_account_id) return jsonResponse({ error: "Missing bank_account_id" }, 400);
      const { data: allActive } = await supabase.from("vendor_bank_accounts").select("id, vendor_id, is_primary").eq("vendor_id",
        (await supabase.from("vendor_bank_accounts").select("vendor_id").eq("id", bank_account_id).single()).data?.vendor_id
      ).eq("is_active", true);
      const { error } = await supabase.from("vendor_bank_accounts").update({ is_active: false, deactivation_reason: reason || "Removed via Edit" }).eq("id", bank_account_id);
      if (error) throw error;
      // If we just deactivated the primary account and another one remains active, promote the oldest remaining one
      const target = (allActive || []).find((b: any) => b.id === bank_account_id);
      if (target?.is_primary) {
        const { data: remaining } = await supabase.from("vendor_bank_accounts").select("id").eq("vendor_id", target.vendor_id).eq("is_active", true).neq("id", bank_account_id).order("created_at").limit(1).maybeSingle();
        if (remaining) await supabase.from("vendor_bank_accounts").update({ is_primary: true }).eq("id", remaining.id);
      }
      return jsonResponse({ success: true }, 200);
    }

    // ---------------- CREATE VENDOR (always creates Branch 1 too) ----------------
    if (action === "create_vendor") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.create"))) return jsonResponse({ error: "You don't have permission to create vendors" }, 403);

      const { core, branch, bank, related_vendor_id } = body;
      const vendorType = core?.vendor_type === "individual" ? "individual" : "company";

      if (!core?.vendor_name) return jsonResponse({ error: vendorType === "individual" ? "Individual Name is required" : "Company Name is required" }, 400);
      if (!core?.deals_in) return jsonResponse({ error: "Deals In is required" }, 400);
      if (!core?.primary_contact_mobile) return jsonResponse({ error: "Primary Mobile is required" }, 400);
      if (!MOBILE_RE.test(core.primary_contact_mobile)) return jsonResponse({ error: "Invalid mobile number" }, 400);
      if (vendorType === "company" && core.msme_registered && !core.msme_number) return jsonResponse({ error: "MSME Number is required since MSME Registered is Yes" }, 400);

      if (vendorType === "company" && !branch?.branch_name) return jsonResponse({ error: "Branch Name is required" }, 400);
      if (!branch?.address || !branch?.state_id) return jsonResponse({ error: "Address and State are required" }, 400);
      if (branch?.pincode && !PINCODE_RE.test(branch.pincode)) return jsonResponse({ error: "Invalid pincode" }, 400);
      // Individuals don't think in terms of "branches" — default a name behind the scenes so the schema's NOT NULL constraint is satisfied invisibly
      if (vendorType === "individual" && !branch?.branch_name) branch.branch_name = core.vendor_name || "Primary";

      let pan: string | null = null;
      let gstin: string | null = null;
      if (vendorType === "individual") {
        if (!core?.aadhar_number) return jsonResponse({ error: "Aadhar Number is required" }, 400);
        const aadhar = core.aadhar_number.replace(/\s/g, "");
        if (!AADHAR_RE.test(aadhar)) return jsonResponse({ error: "Invalid Aadhar Number (must be 12 digits)" }, 400);
        const { data: existingByAadhar } = await supabase.from("vendors").select("id, vendor_code, vendor_name").eq("aadhar_number", aadhar).maybeSingle();
        if (existingByAadhar) return jsonResponse({ error: `An individual/contractor with this Aadhar is already registered as ${existingByAadhar.vendor_code} (${existingByAadhar.vendor_name}).` }, 409);
        core.aadhar_number = aadhar;
      } else {
        if (!core?.pan) return jsonResponse({ error: "PAN is required" }, 400);
        pan = core.pan.toUpperCase().trim();
        if (!PAN_RE.test(pan)) return jsonResponse({ error: "Invalid PAN format (must be AAAAA9999A)" }, 400);
        if (!branch?.gstin) return jsonResponse({ error: "GST Number is required" }, 400);
        gstin = branch.gstin.toUpperCase().trim();
        if (!GSTIN_RE.test(gstin)) return jsonResponse({ error: "Invalid GSTIN format" }, 400);
        const embeddedPan = gstin.substring(2, 12);
        if (embeddedPan !== pan) return jsonResponse({ error: `GSTIN implies PAN "${embeddedPan}" but "${pan}" was entered — please check both.` }, 400);

        const { data: existingGstin } = await supabase.from("vendor_branches").select("id, vendor_id, vendors(vendor_code, vendor_name, pan)").eq("gstin", gstin).maybeSingle();
        if (existingGstin) {
          return jsonResponse({ error: `This GSTIN is already registered under vendor ${(existingGstin as any).vendors?.vendor_code} (${(existingGstin as any).vendors?.vendor_name}). Please use "+ Add Branch" on that vendor instead of creating a new one.` }, 409);
        }
        const { data: existingPan } = await supabase.from("vendors").select("id, vendor_code, vendor_name").eq("pan", pan).maybeSingle();
        if (existingPan) {
          return jsonResponse({ error: `This PAN already belongs to vendor ${existingPan.vendor_code} (${existingPan.vendor_name}). Please use "+ Add Branch" on that vendor instead of creating a new one.` }, 409);
        }
      }

      const { data: newVendor, error: newVendorErr } = await supabase.from("vendors").insert({
        vendor_type: vendorType,
        vendor_name: core.vendor_name,
        vendor_alias: core.vendor_alias || null,
        deals_in: core.deals_in,
        is_test_entry: requester.role === "owner" ? !!core.is_test_entry : false,
        pan, aadhar_number: vendorType === "individual" ? core.aadhar_number : null,
        is_trader: core.is_trader || false, is_manufacturer: core.is_manufacturer || false,
        is_exporter: core.is_exporter || false, is_service_provider: core.is_service_provider || false,
        msme_registered: core.msme_registered || false, msme_number: core.msme_registered ? core.msme_number : null,
        primary_contact_name: core.primary_contact_name || core.vendor_name,
        primary_contact_mobile: core.primary_contact_mobile,
        other_numbers: core.other_numbers || null,
        primary_contact_email: core.primary_contact_email || null,
        payment_terms_days: core.payment_terms_days || null,
        tds_applicable: core.tds_applicable || false, tds_section: core.tds_applicable ? core.tds_section : null,
        status: "draft", created_by: requester_id,
      }).select().single();
      if (newVendorErr) throw newVendorErr;
      const vendorId = newVendor.id;

      const { data: newBranch, error: branchErr } = await supabase.from("vendor_branches").insert({
        vendor_id: vendorId, branch_name: branch.branch_name, branch_alias: branch.branch_alias || null,
        gstin, address: branch.address, state_id: branch.state_id, city_id: branch.city_id || null,
        pincode: branch.pincode || null, location_url: branch.location_url || null,
      }).select().single();
      if (branchErr) throw branchErr;

      if (Array.isArray(branch.contacts)) {
        for (const c of branch.contacts) {
          try { await resolveContact(supabase, { branch_id: newBranch.id }, c); } catch (e) { return jsonResponse({ error: (e as Error).message }, 400); }
        }
      }
      if (bank && (vendorType === "company" || bank.has_bank_account !== false)) {
        try { await resolveBankAccount(supabase, vendorId, newBranch.id, bank); } catch (e) { return jsonResponse({ error: (e as Error).message }, 400); }
      }

      if (related_vendor_id) {
        const { error: relErr } = await supabase.from("vendor_relationships").insert({ vendor_id_a: related_vendor_id, vendor_id_b: vendorId, created_by: requester_id });
        if (relErr) throw relErr;
      }

      return jsonResponse({ success: true, vendor_id: vendorId, note: "New vendor created." }, 200);
    }

    // ---------------- ADD BRANCH (same-GST case — adds to an existing vendor) ----------------
    if (action === "add_branch") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.edit"))) return jsonResponse({ error: "You don't have permission to edit vendors" }, 403);
      const { vendor_id, branch, bank } = body;
      if (!vendor_id) return jsonResponse({ error: "Missing vendor_id" }, 400);
      if (!branch?.branch_name) return jsonResponse({ error: "Branch Name is required" }, 400);
      if (!branch?.address || !branch?.state_id) return jsonResponse({ error: "Branch Address and State are required" }, 400);
      if (branch?.pincode && !PINCODE_RE.test(branch.pincode)) return jsonResponse({ error: "Invalid pincode" }, 400);
      if (!branch?.gstin) return jsonResponse({ error: "GST Number is required" }, 400);

      const { data: vendor } = await supabase.from("vendors").select("pan, vendor_type").eq("id", vendor_id).single();
      if (vendor?.vendor_type !== "company") return jsonResponse({ error: "Only company vendors can have multiple branches" }, 400);

      const gstin = branch.gstin.toUpperCase().trim();
      if (!GSTIN_RE.test(gstin)) return jsonResponse({ error: "Invalid GSTIN format" }, 400);
      const embeddedPan = gstin.substring(2, 12);
      if (embeddedPan !== vendor.pan) return jsonResponse({ error: `This GSTIN belongs to PAN "${embeddedPan}", but this vendor's PAN is "${vendor.pan}" — the "Same GST" declaration doesn't match what you entered.` }, 400);

      const { data: existingWithGstin } = await supabase.from("vendor_branches").select("id, vendor_id").eq("gstin", gstin).maybeSingle();
      if (existingWithGstin && existingWithGstin.vendor_id !== vendor_id) {
        return jsonResponse({ error: "This GSTIN belongs to a different vendor entirely — cannot add it as a branch here." }, 409);
      }
      if (existingWithGstin && existingWithGstin.vendor_id === vendor_id) {
        // Fine — same vendor, same GSTIN, just a genuinely new branch/location under that same registration. Continue.
      }

      const { data: newBranch, error: branchErr } = await supabase.from("vendor_branches").insert({
        vendor_id, branch_name: branch.branch_name, branch_alias: branch.branch_alias || null,
        gstin, address: branch.address, state_id: branch.state_id, city_id: branch.city_id || null,
        pincode: branch.pincode || null, location_url: branch.location_url || null,
      }).select().single();
      if (branchErr) {
        if (branchErr.message?.includes("duplicate")) return jsonResponse({ error: "A branch with this name already exists for this vendor." }, 409);
        throw branchErr;
      }

      if (Array.isArray(branch.contacts)) {
        for (const c of branch.contacts) {
          try { await resolveContact(supabase, { branch_id: newBranch.id }, c); } catch (e) { return jsonResponse({ error: (e as Error).message }, 400); }
        }
      }
      if (bank) {
        try { await resolveBankAccount(supabase, vendor_id, newBranch.id, bank); } catch (e) { return jsonResponse({ error: (e as Error).message }, 400); }
      }

      return jsonResponse({ success: true, branch_id: newBranch.id }, 200);
    }

    // ---------------- Check GSTIN before committing to "different" path (used by the Add Branch wizard) ----------------
    if (action === "check_gstin_for_new_vendor") {
      const { gstin, vendor_id } = body;
      if (!gstin) return jsonResponse({ error: "Missing gstin" }, 400);
      const g = gstin.toUpperCase().trim();
      const { data: existing } = await supabase.from("vendor_branches").select("id, vendor_id, vendors(vendor_code, vendor_name)").eq("gstin", g).maybeSingle();
      if (existing && existing.vendor_id === vendor_id) {
        return jsonResponse({ error: `You said this GST is "Different", but it's actually already on this same vendor. Please choose "Same GST" instead, or check the number.` }, 400);
      }
      if (existing) {
        return jsonResponse({ success: true, exists: true, existing_vendor: (existing as any).vendors }, 200);
      }
      return jsonResponse({ success: true, exists: false }, 200);
    }

    // ---------------- Get reusable contacts/banks for a vendor (for the reuse-checkbox pickers) ----------------
    if (action === "get_reusable_contacts_and_banks") {
      const { vendor_id } = body;
      if (!vendor_id) return jsonResponse({ error: "Missing vendor_id" }, 400);
      const branchIds = (await supabase.from("vendor_branches").select("id").eq("vendor_id", vendor_id)).data?.map((b: any) => b.id) || [];
      const [contactsRes, banksRes] = await Promise.all([
        branchIds.length > 0
          ? supabase.from("vendor_contact_branch_links").select("vendor_contacts(id, name, mobile)").in("branch_id", branchIds)
          : { data: [] as any[] },
        supabase.from("vendor_bank_accounts").select("id, bank_name, account_number, ifsc").eq("vendor_id", vendor_id),
      ]);
      const seen = new Set();
      const contacts = (contactsRes.data || []).map((r: any) => r.vendor_contacts).filter((c: any) => c && !seen.has(c.id) && seen.add(c.id));
      return jsonResponse({ success: true, contacts, bankAccounts: banksRes.data || [] }, 200);
    }

    // ---------------- UPLOAD DOCUMENT ----------------
    if (action === "upload_document") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.edit"))) return jsonResponse({ error: "You don't have permission to edit vendors" }, 403);
      const { vendor_id, slot, file_base64, file_ext, document_name } = body;
      if (!vendor_id || !slot || !file_base64) return jsonResponse({ error: "Missing vendor_id, slot, or file" }, 400);
      const base64Data = file_base64.includes(",") ? file_base64.split(",")[1] : file_base64;
      const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
      const ext = file_ext || "jpg";
      const contentType = ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`;
      if (slot !== "other") {
        const { data: existing } = await supabase.from("vendor_documents").select("id, file_url").eq("vendor_id", vendor_id).eq("slot", slot).maybeSingle();
        if (existing) {
          await supabase.storage.from("vendor-documents").remove([existing.file_url]);
          await supabase.from("vendor_documents").delete().eq("id", existing.id);
        }
      }
      const path = `${vendor_id}/${slot}_${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("vendor-documents").upload(path, binaryData, { contentType, upsert: true });
      if (uploadErr) return jsonResponse({ error: "Upload failed: " + uploadErr.message }, 500);
      const { data: docRow, error: insertErr } = await supabase.from("vendor_documents").insert({ vendor_id, slot, document_name: document_name || slot, file_url: path }).select().single();
      if (insertErr) throw insertErr;
      return jsonResponse({ success: true, document: docRow }, 200);
    }

    // ---------------- APPROVAL WORKFLOW ----------------
    if (action === "submit_for_approval") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.edit"))) return jsonResponse({ error: "You don't have permission to edit vendors" }, 403);
      const { vendor_id } = body;
      const bankRes = await supabase.from("vendor_bank_accounts").select("id").eq("vendor_id", vendor_id);
      if (!bankRes.data || bankRes.data.length === 0) return jsonResponse({ error: "At least one bank account is required before submitting for approval" }, 400);
      const { data: updated, error } = await supabase.from("vendors").update({ status: "pending_approval", updated_at: new Date().toISOString() }).eq("id", vendor_id).eq("status", "draft").select().single();
      if (error) throw error;
      return jsonResponse({ success: true, vendor: updated }, 200);
    }
    if (action === "approve_vendor") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.approve"))) return jsonResponse({ error: "You don't have permission to approve vendors" }, 403);
      const { vendor_id } = body;
      const { data: updated, error } = await supabase.from("vendors").update({ status: "approved", approved_by: requester_id, approved_at: new Date().toISOString() }).eq("id", vendor_id).eq("status", "pending_approval").select().single();
      if (error) throw error;
      return jsonResponse({ success: true, vendor: updated }, 200);
    }
    if (action === "reject_vendor") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.approve"))) return jsonResponse({ error: "You don't have permission to approve/reject vendors" }, 403);
      const { vendor_id, reason } = body;
      if (!reason?.trim()) return jsonResponse({ error: "A rejection reason is required" }, 400);
      const { data: updated, error } = await supabase.from("vendors").update({ status: "rejected", rejection_reason: reason.trim() }).eq("id", vendor_id).eq("status", "pending_approval").select().single();
      if (error) throw error;
      return jsonResponse({ success: true, vendor: updated }, 200);
    }
    if (action === "update_vendor_status") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.delete"))) return jsonResponse({ error: "You don't have permission to change vendor status" }, 403);
      const { vendor_id, new_status } = body;
      if (!["approved", "suspended"].includes(new_status)) return jsonResponse({ error: "Invalid status" }, 400);
      const { data: updated, error } = await supabase.from("vendors").update({ status: new_status, updated_at: new Date().toISOString() }).eq("id", vendor_id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, vendor: updated }, 200);
    }
    if (action === "update_blacklist_status") {
      if (!(await hasPermission(supabase, requester_id, requester.role, "vendor_master.delete"))) return jsonResponse({ error: "You don't have permission to change blacklist status" }, 403);
      const { vendor_id, blacklist_status } = body;
      if (!["not_blacklisted", "blacklisted"].includes(blacklist_status)) return jsonResponse({ error: "Invalid blacklist status" }, 400);
      const { data: updated, error } = await supabase.from("vendors").update({ blacklist_status, updated_at: new Date().toISOString() }).eq("id", vendor_id).select().single();
      if (error) throw error;
      return jsonResponse({ success: true, vendor: updated }, 200);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
});
