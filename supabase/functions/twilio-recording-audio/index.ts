// ============================================================================
// twilio-recording-audio - stream a call recording to an authenticated practice
// member. Twilio media URLs require Twilio auth (can't be used directly in an
// <audio> tag), so the browser fetches this with the user's Supabase JWT; we
// verify the user's practice owns the call_log, then proxy the audio from Twilio
// using Basic auth (API key SID/secret).
//
// verify_jwt on (the browser sends the session token). GET ?id=<call_log_id>.
// Secrets: TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const err = (msg: string, s = 400) => new Response(JSON.stringify({ error: msg }), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return err("Method not allowed", 405);

  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return err("Missing id");

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return err("Unauthorized", 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return err("Unauthorized", 401);
    const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
    const practiceId = prof?.practice_id;
    if (!practiceId) return err("No practice in context.", 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: row } = await admin.from("call_logs").select("practice_id, recording_url").eq("id", id).maybeSingle();
    if (!row || row.practice_id !== practiceId) return err("Not found", 404);
    if (!row.recording_url) return err("No recording for this call", 404);

    const sid = Deno.env.get("TWILIO_API_KEY_SID");
    const secret = Deno.env.get("TWILIO_API_KEY_SECRET");
    if (!sid || !secret) return err("Twilio not configured", 503);

    // Proxy the media from Twilio (Basic auth), forwarding Range for seeking.
    const range = req.headers.get("range");
    const twRes = await fetch(row.recording_url, {
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${secret}`)}`,
        ...(range ? { Range: range } : {}),
      },
    });
    if (!twRes.ok && twRes.status !== 206) return err(`Twilio media ${twRes.status}`, 502);

    const headers = new Headers(cors);
    headers.set("Content-Type", twRes.headers.get("Content-Type") || "audio/mpeg");
    for (const h of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const v = twRes.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set("Cache-Control", "private, max-age=3600");
    return new Response(twRes.body, { status: twRes.status, headers });
  } catch (e) {
    console.error("twilio-recording-audio error:", e);
    return err(String((e as Error)?.message ?? e), 500);
  }
});
