// log-audit, thin HTTP endpoint for audit events that originate in the browser
// but may have NO active session (e.g. a failed login). verify_jwt=false so it
// accepts anon calls; it captures the real client IP / user-agent and writes via
// the service-role key. When a valid user token IS present, the event is stamped
// with that user's id/email/practice_id instead of trusting the body.
//
// Authenticated app events should prefer the log_audit_event() RPC directly; this
// function exists for the unauthenticated auth-event case + server-side IP capture.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { recordAuditFromReq } from "../_shared/audit.ts";
import { reportEdgeError } from "../_shared/report-error.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Only auth/non-PHI events may be logged through this anon endpoint, so it can't
// be abused to forge PHI-access entries.
const ALLOWED = new Set([
  "auth.login_success",
  "auth.login_failure",
  "auth.logout",
  "auth.password_reset_requested",
  "auth.password_changed",
  "auth.mfa_enrolled",
  "auth.mfa_challenge",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action || "");
    if (!ALLOWED.has(action)) return json({ error: "Unsupported action" }, 400);

    // If a real user token is present, derive identity from it (don't trust body).
    let userId: string | null = null;
    let userEmail: string | null = (body.user_email as string) || null;
    let practiceId: string | null = null;
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (token && token !== ANON) {
      try {
        const scoped = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
        const { data: { user } } = await scoped.auth.getUser(token);
        if (user) {
          userId = user.id;
          userEmail = user.email ?? userEmail;
          const { data: prof } = await admin.from("users").select("practice_id").eq("id", user.id).maybeSingle();
          practiceId = (prof?.practice_id as string) ?? null;
        }
      } catch {
        // ignore, fall back to anon attribution
      }
    }

    await recordAuditFromReq(admin, req, {
      action,
      userId,
      userEmail,
      practiceId,
      resourceType: (body.resource_type as string) || "auth",
      details: (body.details as Record<string, unknown>) || null,
      phiAccessed: false,
    });

    return json({ ok: true });
  } catch (e) {
    await reportEdgeError("log-audit", e);
    // Audit logging must never surface as a user-facing failure.
    return json({ ok: false });
  }
});
