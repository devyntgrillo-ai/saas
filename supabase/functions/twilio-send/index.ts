// ============================================================================
// twilio-send - outbound SMS via Twilio REST API.
//
// Called from Conversations (user JWT), send-due-messages / reactivation drip
// (service role). Resolves the practice's From number, sends the message, and
// stores the Twilio MessageSid on the conversation_messages row when provided.
//
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET.
// Optional: TWILIO_CALLER_ID (fallback From), TWILIO_WEBHOOK_BASE_URL (status cb).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { getTwilioConfig, phonesMatch, sendSms, toE164 } from "../_shared/twilio.ts";
import { a2pSkipEnforcement } from "../_shared/twilio-api.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

interface SendBody {
  practice_id?: string;
  to: string;
  body: string;
  subject?: string;
  consult_id?: string;
  conversation_message_id?: string;
  message_id?: string;
  media_url?: string;
  reactivation_campaign_id?: string;
}

function preview(text: string, max = 80): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cfg = getTwilioConfig();
  if (!cfg) {
    return json({ error: "Twilio isn't configured yet.", code: "twilio_not_configured" }, 503);
  }

  try {
    const payload = (await req.json()) as SendBody;
    const to = String(payload.to || "").trim();
    const body = String(payload.body || "").trim();
    if (!to || !body) return json({ error: "Missing to or body." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve practice_id from consult when omitted (cron sender path).
    let practiceId = payload.practice_id || null;
    if (!practiceId && payload.consult_id) {
      const { data: consult } = await admin
        .from("consults")
        .select("practice_id")
        .eq("id", payload.consult_id)
        .maybeSingle();
      practiceId = consult?.practice_id || null;
    }
    if (!practiceId) return json({ error: "Could not resolve practice." }, 400);

    // When called with a user JWT (not service role), verify practice access.
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isServiceRole = authHeader.replace(/^Bearer\s+/i, "") === serviceKey;
    if (!isServiceRole && authHeader) {
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
      if (prof?.practice_id !== practiceId) return json({ error: "Forbidden" }, 403);
    }

    const { data: practice } = await admin
      .from("practices")
      .select("id, twilio_phone_number, sms_enabled, a2p_brand_status, a2p_campaign_status")
      .eq("id", practiceId)
      .maybeSingle();
    if (!practice) return json({ error: "Practice not found." }, 404);
    if (practice.sms_enabled === false) return json({ error: "SMS is disabled for this practice." }, 403);

    const a2pApproved =
      practice.a2p_brand_status === "approved" && practice.a2p_campaign_status === "approved";
    if (!a2pSkipEnforcement() && practice.twilio_phone_number && !a2pApproved) {
      return json({
        error: "SMS registration is pending. Complete A2P setup in Settings → Phone & Messaging.",
        code: "a2p_pending",
        a2p_brand_status: practice.a2p_brand_status,
        a2p_campaign_status: practice.a2p_campaign_status,
      }, 403);
    }

    const from = practice.twilio_phone_number || cfg.callerIdFallback;
    if (!from) {
      return json({ error: "No Twilio phone number configured for this practice.", code: "no_from_number" }, 503);
    }

    const statusCallback = cfg.webhookBase
      ? `${cfg.webhookBase.replace(/\/$/, "")}/functions/v1/twilio-status`
      : undefined;

    const result = await sendSms(cfg, {
      from,
      to,
      body,
      mediaUrl: payload.media_url,
      statusCallback,
    });

    const nowIso = new Date().toISOString();

    // Link Twilio sid to the pre-inserted conversation message.
    if (payload.conversation_message_id) {
      const { data: msg } = await admin
        .from("conversation_messages")
        .select("meta")
        .eq("id", payload.conversation_message_id)
        .maybeSingle();
      const meta = (msg?.meta && typeof msg.meta === "object" ? msg.meta : {}) as Record<string, unknown>;
      await admin.from("conversation_messages").update({
        meta: { ...meta, twilio_message_sid: result.sid, delivery_status: result.status },
      }).eq("id", payload.conversation_message_id);

      const { data: cm } = await admin
        .from("conversation_messages")
        .select("conversation_id")
        .eq("id", payload.conversation_message_id)
        .maybeSingle();
      if (cm?.conversation_id) {
        await admin.from("conversations").update({
          last_message_at: nowIso,
          last_message_preview: preview(body),
        }).eq("id", cm.conversation_id);
      }
    }

    // Record outbound in the conversation thread when the UI didn't pre-insert a row.
    if (!payload.conversation_message_id) {
      await ensureOutboundConversationMessage(admin, {
        practiceId,
        consultId: payload.consult_id || null,
        to,
        body,
        twilioSid: result.sid,
        nowIso,
        source: payload.consult_id ? "sequence" : "sms",
      });
    }

    return json({ ok: true, sid: result.sid, status: result.status, from: toE164(from), to: toE164(to) });
  } catch (e) {
    console.error("twilio-send error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function ensureOutboundConversationMessage(admin: any, opts: {
  practiceId: string;
  consultId: string | null;
  to: string;
  body: string;
  twilioSid: string;
  nowIso: string;
  source?: string;
}) {
  let consult: {
    patient_first: string | null;
    patient_last: string | null;
    patient_phone: string | null;
    patient_email: string | null;
  } | null = null;

  if (opts.consultId) {
    const { data } = await admin
      .from("consults")
      .select("patient_first, patient_last, patient_phone, patient_email")
      .eq("id", opts.consultId)
      .maybeSingle();
    consult = data;
  }

  let conversationId: string | null = null;

  if (opts.consultId) {
    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("practice_id", opts.practiceId)
      .eq("consult_id", opts.consultId)
      .maybeSingle();
    conversationId = existing?.id || null;
  }

  if (!conversationId) {
    const { data: convRows } = await admin
      .from("conversations")
      .select("id, patient_phone")
      .eq("practice_id", opts.practiceId);
    conversationId = (convRows || []).find((c: { patient_phone: string | null }) =>
      phonesMatch(c.patient_phone || "", opts.to)
    )?.id || null;
  }

  if (!conversationId) {
    const { data: created } = await admin
      .from("conversations")
      .insert({
        practice_id: opts.practiceId,
        consult_id: opts.consultId,
        patient_first: consult?.patient_first || null,
        patient_last: consult?.patient_last || null,
        patient_phone: consult?.patient_phone || opts.to,
        patient_email: consult?.patient_email || null,
        last_message_at: opts.nowIso,
        last_message_preview: preview(opts.body),
        unread_count: 0,
      })
      .select("id")
      .single();
    conversationId = created?.id || null;
  }

  if (!conversationId) return;

  await admin.from("conversation_messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    channel: "sms",
    body: opts.body,
    sent_at: opts.nowIso,
    meta: { twilio_message_sid: opts.twilioSid, source: opts.source || "sms" },
  });
  await admin.from("conversations").update({
    last_message_at: opts.nowIso,
    last_message_preview: preview(opts.body),
  }).eq("id", conversationId);
}
