import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// mailgun-webhook, Mailgun Routes target for patient replies + open tracking.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { processPatientEmailInbound } from "../_shared/mailgun-inbound-handler.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok");
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const form = await req.formData();
    const evt = String(form.get("event") || "");

    if (evt === "opened") {
      const mid = String(form.get("message-id") || form.get("Message-Id") || "");
      if (mid) {
        await admin.from("message_logs").update({ status: "opened" }).eq("mailgun_message_id", mid);
      }
      return json({ ok: true });
    }

    const inbound = await processPatientEmailInbound(admin, form, "mailgun-webhook");
    if (inbound.handled) {
      return json({ ok: true, conversation_id: inbound.conversationId });
    }

    return json({ ok: true, skipped: inbound.reason });
  } catch (e) {
    await reportEdgeError("mailgun-webhook", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
