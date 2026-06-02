// ============================================================================
// twilio-voice-token - mints a Twilio Voice AccessToken (JWT) for the browser
// dialer (@twilio/voice-sdk). The token grants outgoing calls through the
// configured TwiML App. Called with the user's Supabase JWT (verify_jwt=true);
// the identity is scoped to the caller's practice.
//
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET,
//          TWILIO_TWIML_APP_SID.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import jwt from "npm:jsonwebtoken@9";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID");
  const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET");
  const appSid = Deno.env.get("TWILIO_TWIML_APP_SID");
  if (!accountSid || !apiKeySid || !apiKeySecret || !appSid) {
    return json({ error: "Voice calling isn't configured yet.", code: "twilio_voice_not_configured" }, 503);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
    const practiceId = prof?.practice_id;
    if (!practiceId) return json({ error: "No practice in context." }, 400);

    // Identity ties the browser client to this practice (alnum/._- only).
    const identity = `practice_${String(practiceId).replace(/[^a-zA-Z0-9._-]/g, "")}`;
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        grants: {
          identity,
          voice: { incoming: { allow: true }, outgoing: { application_sid: appSid } },
        },
      },
      apiKeySecret,
      {
        algorithm: "HS256",
        issuer: apiKeySid,
        subject: accountSid,
        jwtid: `${apiKeySid}-${now}`,
        expiresIn: 3600,
        header: { cty: "twilio-fpa;v=1", typ: "JWT", alg: "HS256" },
      },
    );

    return json({ token, identity, expires_in: 3600 });
  } catch (e) {
    console.error("twilio-voice-token error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
