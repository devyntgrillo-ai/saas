import { reportEdgeError } from "../_shared/report-error.ts";
// link-sikka-practice — practice admin looks up their Sikka office (SPU practice
// ID) in the webhook registration queue, confirms, and links to their CaseLift
// practice. Discovery + ingest follow via PmsSyncApproval on the client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { assertPracticeAdmin } from "../_shared/pms-sync.ts";
import { issuePracticeTokens } from "../_shared/sikka.ts";
import {
  normalizeSikkaOfficeId,
  practiceIdFromRegistrationRaw,
  registrationPreview,
  tokensFromRegistrationRaw,
} from "../_shared/sikka-registration.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const OPEN_STATUSES = ["pending", "unlinked"];

// deno-lint-ignore no-explicit-any
async function findOpenRegistration(admin: any, officeId: string) {
  const { data, error } = await admin
    .from("sikka_registrations")
    .select("id, sikka_practice_id, practice_name, npi, raw, status, matched_practice_id, created_at")
    .eq("sikka_practice_id", officeId)
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "lookup");
    const officeId = normalizeSikkaOfficeId(body.sikka_practice_id ?? body.office_id);
    if (!officeId) return json({ error: "Enter your Sikka Practice ID from the SPU." }, 400);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    let practiceId: string | null = body.practice_id ?? null;
    if (!practiceId) {
      const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
      practiceId = prof?.practice_id ?? null;
    }
    if (!practiceId) return json({ error: "No practice in context." }, 400);

    const gate = await assertPracticeAdmin(userClient, user.id, practiceId, user.email, admin);
    if (!gate.ok) return json({ error: gate.error }, gate.error.includes("admin") ? 403 : 400);

    // Already linked to another CaseLift practice?
    const { data: taken } = await admin
      .from("practices")
      .select("id, name")
      .eq("sikka_practice_id", officeId)
      .neq("id", practiceId)
      .maybeSingle();
    if (taken) {
      return json({
        error: "This Sikka Practice ID is already linked to another CaseLift account.",
        code: "office_taken",
      }, 409);
    }

    const { data: linkedReg } = await admin
      .from("sikka_registrations")
      .select("id, matched_practice_id")
      .eq("sikka_practice_id", officeId)
      .eq("status", "linked")
      .neq("matched_practice_id", practiceId)
      .maybeSingle();
    if (linkedReg) {
      return json({ error: "This Sikka Practice ID is already linked to another CaseLift account.", code: "office_taken" }, 409);
    }

    const registration = await findOpenRegistration(admin, officeId);
    if (!registration) {
      return json({
        error: "We haven't received a sync from that Practice ID yet. Finish setup in the Sikka Practice Utility (SPU), then try again.",
        code: "not_found",
      }, 404);
    }

    if (action === "lookup") {
      return json({ ok: true, registration: registrationPreview(registration) });
    }

    if (action !== "link") return json({ error: "Unknown action." }, 400);

    const preview = registrationPreview(registration);
    const practiceIdSikka = practiceIdFromRegistrationRaw(registration.raw);
    let tokens = tokensFromRegistrationRaw(registration.raw);
    let hasApiTokens = Boolean(tokens.refresh_token || tokens.request_key);

    // Partner-side: enable API location access + fetch fresh tokens for discovery.
    try {
      const issued = await issuePracticeTokens(officeId, practiceIdSikka);
      tokens = {
        request_key: issued.request_key,
        refresh_token: issued.refresh_token,
        expires_at: issued.expires_at,
      };
      hasApiTokens = true;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      console.warn("link-sikka-practice: issuePracticeTokens failed:", msg);
      if (!hasApiTokens) {
        return json({
          error: "Could not enable API access for this practice. Confirm SPU sync finished, then try again.",
          code: "sikka_not_authorized",
          detail: msg,
        }, 502);
      }
    }

    // deno-lint-ignore no-explicit-any
    const practicePatch: Record<string, any> = {
      sikka_practice_id: officeId,
      sikka_connected: true,
      pms_connected: true,
    };
    if (preview.pms_type) practicePatch.pms_type = preview.pms_type;
    if (tokens.request_key) practicePatch.sikka_request_key = tokens.request_key;
    if (tokens.refresh_token) practicePatch.sikka_refresh_token = tokens.refresh_token;
    if (tokens.request_key || tokens.refresh_token) {
      practicePatch.sikka_token_expires_at = tokens.expires_at;
    }

    await admin.from("practices").update(practicePatch).eq("id", practiceId);
    await admin.from("sikka_registrations").update({
      status: "linked",
      matched_practice_id: practiceId,
    }).eq("id", registration.id);

    await admin.from("audit_logs").insert({
      practice_id: practiceId,
      action: "pms.sikka_linked",
      resource_type: "practice",
      resource_id: practiceId,
      meta: { sikka_practice_id: officeId, registration_id: registration.id },
    }).then(() => {}, () => {});

    return json({
      ok: true,
      practice_id: practiceId,
      sikka_practice_id: officeId,
      registration: preview,
      has_api_tokens: hasApiTokens,
    });
  } catch (e) {
    await reportEdgeError("link-sikka-practice", e);
    console.error("link-sikka-practice error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
