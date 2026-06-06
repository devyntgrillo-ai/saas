import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// twilio-voice-inbound — Twilio Voice webhook when a patient calls the
// practice's Twilio number. Finds/creates the conversation, logs an inbound
// call, then rings the browser (Twilio Client) and/or a configured forward
// phone number with dual-channel recording.
//
// Deploy with verify_jwt=false (Twilio calls this, no Supabase JWT).
// Point each practice number's Voice URL to:
//   {TWILIO_WEBHOOK_BASE_URL}/functions/v1/twilio-voice-inbound?practice_id={id}
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  practiceClientIdentity,
  resolveConversationForPatient,
  resolvePracticeFromTwilioNumber,
} from "../_shared/inbound-routing.ts";
import {
  formDataToRecord,
  getTwilioConfig,
  toE164,
  twilioWebhookUrl,
  validateTwilioSignature,
} from "../_shared/twilio.ts";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "Content-Type": "text/xml" } });

function formatDurationLabel(secs: number): string {
  const s = Math.max(0, Math.floor(secs || 0));
  if (s <= 0) return "";
  return ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return xml("<Response><Reject/></Response>");

  try {
    const form = await req.formData();
    const params = formDataToRecord(form);
    const url = new URL(req.url);
    const phase = url.searchParams.get("phase") || "route";

    const cfg = getTwilioConfig();
    const publicBase = Deno.env.get("TWILIO_WEBHOOK_BASE_URL") || cfg?.webhookBase || null;
    const skipSignature =
      Deno.env.get("TWILIO_SKIP_WEBHOOK_SIGNATURE") === "true" ||
      !!publicBase?.match(/devtunnels|ngrok|localhost\.run/i);
    if (cfg?.authToken && req.headers.get("X-Twilio-Signature") && !skipSignature) {
      const sig = req.headers.get("X-Twilio-Signature") || "";
      const webhookUrl = twilioWebhookUrl(req, publicBase, "twilio-voice-inbound");
      const valid = await validateTwilioSignature(cfg.authToken, sig, webhookUrl, params);
      if (!valid) {
        console.warn("twilio-voice-inbound: invalid Twilio signature");
        return new Response("Forbidden", { status: 403 });
      }
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const callSid = String(params.CallSid || "").trim();
    const dialStatus = String(params.DialCallStatus || "").trim();
    const dialDuration = Number(params.DialCallDuration || params.CallDuration || 0) || 0;

    // Dial action callback — update call log + conversation message when the ring group ends.
    if (phase === "complete") {
      if (callSid) {
        const status =
          dialStatus === "completed" ? "completed"
          : dialStatus === "no-answer" || dialStatus === "busy" ? "no_answer"
          : dialStatus === "failed" || dialStatus === "canceled" ? "failed"
          : "completed";
        const endedAt = new Date().toISOString();
        await admin.from("call_logs").update({
          status,
          duration_seconds: dialDuration || null,
          ended_at: endedAt,
        }).eq("twilio_call_sid", callSid);

        const { data: cl } = await admin
          .from("call_logs")
          .select("id, conversation_id")
          .eq("twilio_call_sid", callSid)
          .maybeSingle();

        if (cl?.conversation_id) {
          const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const body = `📞 Inbound call ${dateLabel}${formatDurationLabel(dialDuration)}`;
          const { data: msg } = await admin
            .from("conversation_messages")
            .select("id, meta")
            .eq("call_log_id", cl.id)
            .maybeSingle();
          if (msg) {
            const meta = (msg.meta && typeof msg.meta === "object" ? msg.meta : {}) as Record<string, unknown>;
            await admin.from("conversation_messages").update({
              body,
              meta: { ...meta, duration_sec: dialDuration || null },
            }).eq("id", msg.id);
          }
        }
      }
      return xml("<Response></Response>");
    }

    const from = String(params.From || "").trim();
    const to = String(params.To || "").trim();
    if (!from || !to) return xml("<Response><Say>Invalid call.</Say></Response>");

    const practiceIdHint = url.searchParams.get("practice_id")?.trim() || null;
    const practice = await resolvePracticeFromTwilioNumber(admin, to, practiceIdHint);
    if (!practice) {
      console.warn(`twilio-voice-inbound: no practice for To=${to}`);
      return xml("<Response><Say>This number is not configured.</Say></Response>");
    }

    const { data: pr } = await admin
      .from("practices")
      .select("inbound_call_forward_phone, inbound_call_ring_browser")
      .eq("id", practice.id)
      .maybeSingle();

    const ringBrowser = pr?.inbound_call_ring_browser !== false;
    const forwardPhone = pr?.inbound_call_forward_phone ? toE164(pr.inbound_call_forward_phone) : "";

    if (!ringBrowser && !forwardPhone) {
      return xml("<Response><Say>No one is available to take your call. Please try again later.</Say></Response>");
    }

    const { conversation } = await resolveConversationForPatient(admin, practice.id, from);
    const nowIso = new Date().toISOString();
    let callLogId: string | null = null;

    if (callSid) {
      const { data: cl, error: clErr } = await admin
        .from("call_logs")
        .upsert({
          twilio_call_sid: callSid,
          practice_id: practice.id,
          consult_id: conversation.consult_id,
          conversation_id: conversation.id,
          direction: "inbound",
          from_number: from,
          to_number: to,
          status: "ringing",
          started_at: nowIso,
        }, { onConflict: "twilio_call_sid" })
        .select("id")
        .maybeSingle();
      if (clErr) console.error("call_logs upsert failed:", clErr.message);
      callLogId = cl?.id || null;

      if (callLogId) {
        const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
        await admin.from("conversation_messages").insert({
          conversation_id: conversation.id,
          direction: "inbound",
          channel: "call",
          body: `📞 Inbound call ${dateLabel}`,
          sent_at: nowIso,
          call_log_id: callLogId,
          meta: { kind: "call", direction: "inbound", from },
        });
      }
    }

    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const recCb = `${base}/functions/v1/twilio-recording-callback`;
    const actionUrl =
      `${base}/functions/v1/twilio-voice-inbound?phase=complete&practice_id=${encodeURIComponent(practice.id)}`;

    const clientIdentity = practiceClientIdentity(practice.id);
    let dialInner = "";
    if (ringBrowser) {
      dialInner +=
        `<Client statusCallbackEvent="initiated ringing answered completed">` +
        `<Identity>${esc(clientIdentity)}</Identity>`;
      if (conversation.id) {
        dialInner += `<Parameter name="conversation_id" value="${esc(conversation.id)}" />`;
      }
      if (callLogId) {
        dialInner += `<Parameter name="call_log_id" value="${esc(callLogId)}" />`;
      }
      dialInner += `</Client>`;
    }
    if (forwardPhone) {
      dialInner += `<Number>${esc(forwardPhone)}</Number>`;
    }

    return xml(
      `<Response>` +
        `<Dial timeout="30" answerOnBridge="true" record="record-from-answer-dual"` +
        ` recordingStatusCallback="${esc(recCb)}" recordingStatusCallbackEvent="completed"` +
        ` action="${esc(actionUrl)}" method="POST">` +
        dialInner +
        `</Dial>` +
        `<Say>No one is available to take your call. Please try again later.</Say>` +
        `</Response>`,
    );
  } catch (e) {
    await reportEdgeError("twilio-voice-inbound", e);
    console.error("twilio-voice-inbound error:", e);
    return xml("<Response><Say>An error occurred.</Say></Response>");
  }
});
