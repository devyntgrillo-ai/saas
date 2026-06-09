import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// mailgun-inbound — patient email replies (reply+{conversation_id}@inbound host).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { processPatientEmailInbound } from "../_shared/mailgun-inbound-handler.ts";
import { verifyMailgunWebhook } from "../_shared/mailgun.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const form = await req.formData();
    const timestamp = String(form.get("timestamp") || "");
    const token = String(form.get("token") || "");
    const signature = String(form.get("signature") || "");

    const signingKey = Deno.env.get("MAILGUN_WEBHOOK_SIGNING_KEY") || "";
    if (signingKey) {
      const valid = await verifyMailgunWebhook(signingKey, timestamp, token, signature);
      if (!valid) {
        console.warn("mailgun-inbound: invalid signature");
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await processPatientEmailInbound(admin, form);
    return ok();
  } catch (e) {
    await reportEdgeError("mailgun-inbound", e);
    console.error("mailgun-inbound error:", e);
    return ok();
  }
});
