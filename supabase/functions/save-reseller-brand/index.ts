import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// save-reseller-brand - persist a reseller's white-label brand fields with the
// service role, so a super-admin editing brand WHILE IMPERSONATING (or an agency
// owner/admin) always saves regardless of agency_accounts RLS.
//
// Gate: caller is a super-admin (access_level/email) OR an owner/admin of the
// target agency. Only an allowlisted set of brand columns can be written.
//
// Body: { agency_id, patch }  →  { ok, agency }
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";

// Brand columns the reseller settings UI is allowed to write.
const ALLOWED = new Set([
  "company_name",
  "brand_name",
  "logo_url",
  "logo_url_dark",
  "logo_url_light",
  "favicon_url",
  "primary_color",
  "support_email",
  "domain",
  "white_label_enabled",
]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const agencyId: string | undefined = body.agency_id;
    const rawPatch = (body.patch ?? {}) as Record<string, unknown>;
    if (!agencyId) return json({ error: "agency_id is required" }, 400);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // --- Authorize: super-admin, or owner/admin of this agency. ---
    const { data: me } = await admin.from("users").select("access_level").eq("id", user.id).maybeSingle();
    const isSuper = me?.access_level === "super_admin" || (user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
    let allowed = isSuper;
    if (!allowed) {
      const { data: mem } = await admin
        .from("agency_members")
        .select("role")
        .eq("agency_id", agencyId)
        .eq("user_id", user.id)
        .maybeSingle();
      allowed = Boolean(mem && ["owner", "admin"].includes(mem.role));
    }
    if (!allowed) return json({ error: "You cannot edit this reseller's brand." }, 403);

    // --- Whitelist the patch. ---
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawPatch)) {
      if (ALLOWED.has(k)) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) return json({ error: "No writable brand fields in patch." }, 400);

    const { data, error } = await admin
      .from("agency_accounts")
      .update(patch)
      .eq("id", agencyId)
      .select()
      .maybeSingle();
    if (error) return json({ error: error.message }, 502);

    return json({ ok: true, agency: data });
  } catch (e) {
    await reportEdgeError("save-reseller-brand", e);
    console.error("save-reseller-brand error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
