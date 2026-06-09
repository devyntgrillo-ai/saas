import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// twilio-inbound - Twilio webhook for inbound SMS replies.
//
// Twilio POSTs application/x-www-form-urlencoded with From, To, Body, MessageSid.
// Resolves the practice by the To number, finds or creates a conversation,
// inserts an inbound conversation_message (triggers auto-pause + attribution),
// handles STOP/UNSUBSCRIBE opt-outs, and returns empty TwiML.
//
// Deploy with verify_jwt=false (see config.toml). For local dev, forward port
// 54321 and set the Twilio number's Messaging webhook to:
//   {public-url}/functions/v1/twilio-inbound
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_* (for optional sig).
// Optional: TWILIO_AUTH_TOKEN (validates X-Twilio-Signature when set).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  formDataToRecord,
  getTwilioConfig,
  isOptOutMessage,
  phonesMatch,
  toE164,
  twilioWebhookUrl,
  validateTwilioSignature,
} from "../_shared/twilio.ts";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = () =>
  new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });

function preview(text: string, max = 80): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return twiml();

  try {
    const form = await req.formData();
    const params = formDataToRecord(form);
    const from = String(params.From || "").trim();
    const to = String(params.To || "").trim();
    const body = String(params.Body || "").trim();
    const messageSid = String(params.MessageSid || "").trim();

    if (!from || !to) return twiml();

    const cfg = getTwilioConfig();
    const publicBase = Deno.env.get("TWILIO_WEBHOOK_BASE_URL") || cfg?.webhookBase || null;
    // Dev tunnels rewrite paths — skip signature check locally (still enforced in prod).
    const skipSignature =
      Deno.env.get("TWILIO_SKIP_WEBHOOK_SIGNATURE") === "true" ||
      !!publicBase?.match(/devtunnels|ngrok|localhost\.run/i);
    if (cfg?.authToken && req.headers.get("X-Twilio-Signature") && !skipSignature) {
      const sig = req.headers.get("X-Twilio-Signature") || "";
      const url = twilioWebhookUrl(req, publicBase, "twilio-inbound");
      const valid = await validateTwilioSignature(cfg.authToken, sig, url, params);
      if (!valid) {
        console.warn("twilio-inbound: invalid Twilio signature for url", url);
        return new Response("Forbidden", { status: 403 });
      }
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const practiceIdHint = new URL(req.url).searchParams.get("practice_id")?.trim() || null;
    const toE164Norm = toE164(to);

    let practice: { id: string } | null = null;

    if (practiceIdHint) {
      const { data: hinted } = await admin
        .from("practices")
        .select("id, twilio_phone_number, twilio_phone_e164")
        .eq("id", practiceIdHint)
        .maybeSingle();
      if (
        hinted &&
        (phonesMatch(hinted.twilio_phone_number || "", to) ||
          hinted.twilio_phone_e164 === toE164Norm)
      ) {
        practice = { id: hinted.id };
      }
    }

    if (!practice) {
      const { data: byE164 } = await admin
        .from("practices")
        .select("id")
        .eq("twilio_phone_e164", toE164Norm)
        .maybeSingle();
      if (byE164) practice = { id: byE164.id };
    }

    if (!practice) {
      const { data: practices } = await admin
        .from("practices")
        .select("id, twilio_phone_number")
        .not("twilio_phone_number", "is", null);
      const legacy = (practices || []).find((p) => phonesMatch(p.twilio_phone_number || "", to));
      if (legacy) practice = { id: legacy.id };
    }

    if (!practice) {
      console.warn(`twilio-inbound: no practice for To=${to} hint=${practiceIdHint || "none"}`);
      return twiml();
    }

    const practiceId = practice.id;
    const nowIso = new Date().toISOString();
    const optOut = isOptOutMessage(body);

    // Find existing conversation by patient phone within the practice.
    const { data: convRows } = await admin
      .from("conversations")
      .select("id, unread_count, opted_out, consult_id, patient_first, patient_last, patient_phone")
      .eq("practice_id", practiceId);

    let conversation = (convRows || []).find((c) => phonesMatch(c.patient_phone || "", from)) || null;

    // Fall back to a consult match when no thread exists yet.
    let consult: {
      id: string;
      patient_first: string | null;
      patient_last: string | null;
      patient_phone: string | null;
      patient_email: string | null;
    } | null = null;

    if (!conversation) {
      const { data: consults } = await admin
        .from("consults")
        .select("id, patient_first, patient_last, patient_phone, patient_email")
        .eq("practice_id", practiceId)
        .order("created_at", { ascending: false })
        .limit(200);

      consult = (consults || []).find((c) => phonesMatch(c.patient_phone || "", from)) || null;

      if (consult) {
        const linked = (convRows || []).find((c) => c.consult_id === consult!.id);
        if (linked) conversation = linked;
      }
    }

    if (!conversation) {
      const { data: created, error: createErr } = await admin
        .from("conversations")
        .insert({
          practice_id: practiceId,
          consult_id: consult?.id || null,
          patient_first: consult?.patient_first || null,
          patient_last: consult?.patient_last || null,
          patient_phone: from,
          patient_email: consult?.patient_email || null,
          last_message_at: nowIso,
          last_message_preview: preview(body || "(empty)"),
          unread_count: 1,
          opted_out: optOut,
          opted_out_at: optOut ? nowIso : null,
        })
        .select("id, unread_count, opted_out")
        .single();
      if (createErr) {
        console.error("twilio-inbound: conversation create failed:", createErr.message);
        return twiml();
      }
      conversation = created;
    } else {
      const updates: Record<string, unknown> = {
        last_message_at: nowIso,
        last_message_preview: preview(body || "(empty)"),
        unread_count: (conversation.unread_count || 0) + 1,
      };
      if (optOut) {
        updates.opted_out = true;
        updates.opted_out_at = nowIso;
      }
      await admin.from("conversations").update(updates).eq("id", conversation.id);
    }

    // Collect MMS media URLs when present.
    const numMedia = Number(params.NumMedia || 0);
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const u = params[`MediaUrl${i}`];
      if (u) mediaUrls.push(u);
    }

    await admin.from("conversation_messages").insert({
      conversation_id: conversation!.id,
      direction: "inbound",
      channel: "sms",
      body: body || (mediaUrls.length ? "[Media message]" : ""),
      sent_at: nowIso,
      meta: {
        twilio_message_sid: messageSid || null,
        from,
        to,
        media_urls: mediaUrls.length ? mediaUrls : undefined,
        opt_out: optOut || undefined,
      },
    });

    // Opt-out (STOP/UNSUBSCRIBE) → hard-cancel the patient's follow-up sequence,
    // not just pause it (Part 8). Cancels any not-yet-sent messages.
    if (optOut) {
      const linkedConsultId = (conversation as any)?.consult_id ?? consult?.id ?? null;
      if (linkedConsultId) {
        await admin.from("messages").update({ status: "cancelled" })
          .eq("consult_id", linkedConsultId).in("status", ["draft", "scheduled", "pending"]).then(() => {}, () => {});
        await admin.from("consults").update({
          sequence_status: "cancelled", sequence_cancelled_at: nowIso, sequence_cancelled_reason: "opt_out",
        }).eq("id", linkedConsultId).then(() => {}, () => {});
      }
    }

    // Notify staff of the patient reply (best-effort; never alert on opt-outs).
    if (!optOut) {
      // deno-lint-ignore no-explicit-any
      const cv = conversation as any;
      const patientName = [cv?.patient_first, cv?.patient_last].filter(Boolean).join(" ") ||
        [consult?.patient_first, consult?.patient_last].filter(Boolean).join(" ") || from;
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-staff`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            practice_id: practiceId,
            event_name: "patient_replied",
            payload: { patient_name: patientName, message_preview: (body || "").slice(0, 100) },
          }),
        });
      } catch { /* non-blocking */ }
    }

    return twiml();
  } catch (e) {
    await reportEdgeError("twilio-inbound", e);
    console.error("twilio-inbound error:", e);
    return twiml(); // always ack so Twilio doesn't retry-storm
  }
});
