import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// twilio-recording-audio - stream a call recording to an authenticated practice
// member (or platform super-admin). Twilio media URLs require auth, so the
// browser fetches this with the user's Supabase JWT; we verify access, then
// proxy the audio from Twilio with Basic auth (forwards Range for seeking).
//
// verify_jwt on (the browser sends the session token). GET ?id=<call_log_id>.
// Secrets: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID/SECRET.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { isSuperAdminUser } from "../_shared/admin.ts";
import { getTwilioConfig } from "../_shared/twilio.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const err = (msg: string, s = 400) =>
  new Response(JSON.stringify({ error: msg }), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function twilioAuthHeader(cfg: NonNullable<ReturnType<typeof getTwilioConfig>>): string {
  if (cfg.apiKeySid && cfg.apiKeySecret) {
    return `Basic ${btoa(`${cfg.apiKeySid}:${cfg.apiKeySecret}`)}`;
  }
  if (cfg.authToken) {
    return `Basic ${btoa(`${cfg.accountSid}:${cfg.authToken}`)}`;
  }
  throw new Error("No Twilio credentials configured");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return err("Method not allowed", 405);

  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return err("Missing id");

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return err("Unauthorized", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return err("Unauthorized", 401);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Service role so access_level is always visible for super-admin checks.
    const { data: prof } = await admin.from("users").select("practice_id, access_level").eq("id", user.id).maybeSingle();
    const isSuperAdmin = isSuperAdminUser(user, prof?.access_level);

    const { data: row } = await admin.from("call_logs").select("practice_id, recording_url").eq("id", id).maybeSingle();
    if (!row) return err("Not found", 404);
    if (!isSuperAdmin && row.practice_id !== prof?.practice_id) return err("Not found", 404);
    if (!prof?.practice_id && !isSuperAdmin) return err("No practice in context.", 403);
    if (!row.recording_url) return err("No recording for this call", 404);

    const twilio = getTwilioConfig();
    if (!twilio) return err("Twilio not configured", 503);

    const range = req.headers.get("range");
    const twRes = await fetch(row.recording_url, {
      headers: {
        Authorization: twilioAuthHeader(twilio),
        ...(range ? { Range: range } : {}),
      },
    });
    if (!twRes.ok && twRes.status !== 206) {
      console.error("twilio-recording-audio: Twilio media", twRes.status, row.recording_url);
      return err(`Twilio media ${twRes.status}`, 502);
    }

    const headers = new Headers(cors);
    headers.set("Content-Type", twRes.headers.get("Content-Type") || "audio/mpeg");
    for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const v = twRes.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set("Cache-Control", "private, max-age=3600");
    return new Response(twRes.body, { status: twRes.status, headers });
  } catch (e) {
    await reportEdgeError("twilio-recording-audio", e);
    console.error("twilio-recording-audio error:", e);
    return err(String((e as Error)?.message ?? e), 500);
  }
});
