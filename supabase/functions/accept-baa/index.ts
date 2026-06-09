// accept-baa — records a Business Associate Agreement acceptance as a hardened,
// legally-defensible event: server-side timestamp, the signer's validated
// identity (from their JWT, not the request body), the real client IP /
// user-agent, an immutable baa_acceptances ledger row, and an audit_logs entry.
// All DB writes happen in the record_baa_acceptance() SECURITY DEFINER RPC.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { clientMeta } from "../_shared/audit.ts";
import { reportEdgeError } from "../_shared/report-error.ts";

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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token || token === ANON) return json({ error: "Unauthorized" }, 401);

    // Resolve the signer from their token — never trust the body for identity.
    const scoped = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await scoped.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: prof } = await admin.from("users").select("practice_id, email").eq("id", user.id).maybeSingle();
    const practiceId = (prof?.practice_id as string) ?? null;
    if (!practiceId) return json({ error: "Your account is not linked to a practice." }, 409);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const version = String(body.version || "unversioned");
    const { ipAddress, userAgent } = clientMeta(req);

    const { data: acceptedAt, error } = await admin.rpc("record_baa_acceptance", {
      p_practice_id: practiceId,
      p_user_id: user.id,
      p_user_email: prof?.email ?? user.email ?? null,
      p_version: version,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
    });
    if (error) throw error;

    return json({ ok: true, accepted_at: acceptedAt });
  } catch (e) {
    await reportEdgeError("accept-baa", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
