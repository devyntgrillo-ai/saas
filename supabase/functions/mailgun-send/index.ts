import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// mailgun-send - outbound PATIENT email via per-practice Mailgun subdomain.
// Conversations, send-due-messages, reactivation drip. Platform mail (invites,
// digests) uses sendMailgunMessage with audience platform in other functions.
//
// Secrets: MAILGUN_API_KEY, MAILGUN_PATIENT_MAIL_DOMAIN, MAILGUN_PATIENT_MAIL_ROOT
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { checkPracticeAccess } from "../_shared/auth.ts";
import { resolveBrand } from "../_shared/brand.ts";
import {
  isPatientMailConfigured,
  mailgunFromAddress,
  mailgunInboundReceiveDomain,
  mailgunPlatformDomain,
  sendMailgunMessage,
} from "../_shared/mailgun.ts";
import {
  conversationReplyOnPracticeHost,
  ensurePracticeMailSubdomain,
  resolveConversationForEmail,
} from "../_shared/mailgun-practice.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

interface Body {
  to: string;
  subject?: string | null;
  body: string;
  consult_id?: string;
  message_id?: string;
  practice_id?: string;
  conversation_message_id?: string;
}

function preview(text: string, max = 80): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!isPatientMailConfigured()) {
      return json({
        error: "Patient email is not configured. Set MAILGUN_API_KEY and MAILGUN_PATIENT_MAIL_DOMAIN.",
        code: "mailgun_not_configured",
      }, 503);
    }

    const payload = (await req.json()) as Body;
    const to = String(payload.to || "").trim();
    const body = String(payload.body || "").trim();
    const subject = String(payload.subject || "Follow-up from your care team").trim();
    if (!to || !body) return json({ error: "Missing to or body." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let practiceId = payload.practice_id || null;
    if (!practiceId && payload.consult_id) {
      const { data: c } = await admin.from("consults").select("practice_id").eq("id", payload.consult_id).maybeSingle();
      practiceId = c?.practice_id || null;
    }
    if (!practiceId) return json({ error: "Could not resolve practice." }, 400);

    const access = await checkPracticeAccess(req, practiceId);
    if (!access.ok) return json({ error: access.error }, access.status);

    const { data: pr } = await admin
      .from("practices")
      .select("id, name, email_enabled, email_from_name, email_reply_to, mail_subdomain, mail_from_local_part, agency:agency_accounts(*)")
      .eq("id", practiceId)
      .maybeSingle();
    if (!pr) return json({ error: "Practice not found." }, 404);
    if (pr.email_enabled === false) {
      return json({ error: "Email is disabled for this practice.", code: "email_disabled" }, 403);
    }

    const mail = await ensurePracticeMailSubdomain(admin, pr);
    const brand = await resolveBrand(admin, pr);
    // Practice name first — patient mail should not show "CaseLift" unless the practice has no name.
    const fromName =
      (pr.email_from_name && String(pr.email_from_name).trim()) ||
      (pr.name && String(pr.name).trim()) ||
      brand.companyName ||
      "CaseLift";

    let conversationId: string | null = null;
    if (payload.conversation_message_id) {
      const { data: cm } = await admin
        .from("conversation_messages")
        .select("conversation_id")
        .eq("id", payload.conversation_message_id)
        .maybeSingle();
      conversationId = cm?.conversation_id || null;
    } else if (payload.consult_id) {
      conversationId = await resolveConversationForEmail(admin, practiceId, payload.consult_id, to);
    }

    // Reply-To must land on a Mailgun-receiving host (MAILGUN_INBOUND_DOMAIN / patient mail root).
    // From can be office@{sub}.mysmileinbox.com (send-only) without MX on that host.
    const receiveHost = mailgunInboundReceiveDomain();
    const threadReplyTo = (host: string | null) =>
      conversationId && host ? conversationReplyOnPracticeHost(conversationId, host) : null;
    const inboundReply = threadReplyTo(receiveHost);
    const replyTo = inboundReply || pr.email_reply_to || brand.supportEmail || null;

    const text = body;
    const html =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111827">` +
      `<p style="margin:0 0 12px;color:#6b7280;font-size:13px">${escapeHtml(fromName)}</p>` +
      `<div style="white-space:pre-wrap">${escapeHtml(body)}</div></div>`;

    const platformFrom = mailgunFromAddress("noreply");
    const platformDomain = mailgunPlatformDomain();
    /** Legacy sandbox mode — force platform From (hello@…). Default: per-practice subdomain (Option 2). */
    const forcePlatformOnly = Deno.env.get("MAILGUN_PATIENT_DELIVER_VIA_PLATFORM") === "true";

    let result: Awaited<ReturnType<typeof sendMailgunMessage>>;
    let usedFallback = false;
    let sentReplyTo: string | null = replyTo;
    let sentFromAddress = mail.fromAddress;

    const sendPatient = () =>
      sendMailgunMessage({
        to,
        subject,
        text,
        html,
        fromName,
        replyTo,
        fromAddress: mail.fromAddress,
        audience: "patient",
        mailgunDomain: mail.apiDomain,
      });

    const sendPlatform = (platformReplyTo: string | null) =>
      sendMailgunMessage({
        to,
        subject,
        text,
        html,
        fromName,
        replyTo: platformReplyTo,
        fromAddress: platformFrom!,
        audience: "platform",
        mailgunDomain: platformDomain!,
      });

    if (forcePlatformOnly && platformFrom && platformDomain) {
      const platformReply = threadReplyTo(receiveHost) || replyTo;
      sentReplyTo = platformReply;
      sentFromAddress = platformFrom;
      result = await sendPlatform(platformReply);
      usedFallback = true;
    } else {
      result = await sendPatient();
      if (
        !result.sent &&
        platformFrom &&
        platformDomain &&
        (result.reason === "mailgun_401" ||
          result.reason === "mailgun_403" ||
          result.reason === "mailgun_404")
      ) {
        console.warn(`mailgun-send: patient domain failed (${result.reason}); trying ${platformDomain}`);
        const platformReply = threadReplyTo(receiveHost) || replyTo;
        sentReplyTo = platformReply;
        sentFromAddress = platformFrom;
        result = await sendPlatform(platformReply);
        usedFallback = result.sent;
      }
    }

    if (!result.sent) {
      return json({ error: result.reason, detail: result.detail }, result.reason === "mailgun_not_configured" ? 503 : 502);
    }

    const nowIso = new Date().toISOString();
    if (payload.conversation_message_id) {
      const { data: msg } = await admin
        .from("conversation_messages")
        .select("meta")
        .eq("id", payload.conversation_message_id)
        .maybeSingle();
      const meta = (msg?.meta && typeof msg.meta === "object" ? msg.meta : {}) as Record<string, unknown>;
      await admin.from("conversation_messages").update({
        meta: {
          ...meta,
          mailgun_id: result.id,
          delivery_status: "sent",
          subject: subject || null,
          reply_to: sentReplyTo,
          from_address: sentFromAddress,
          mail_subdomain: mail.subdomain,
          used_platform_fallback: usedFallback,
        },
      }).eq("id", payload.conversation_message_id);

      if (conversationId) {
        await admin.from("conversations").update({
          last_message_at: nowIso,
          last_message_preview: preview(body),
        }).eq("id", conversationId);
      }
    }

    return json({
      ok: true,
      mailgun_id: result.id,
      from_address: sentFromAddress,
      from_name: fromName,
      mail_subdomain: mail.subdomain,
      used_platform_fallback: usedFallback,
    });
  } catch (e) {
    await reportEdgeError("mailgun-send", e);
    console.error("mailgun-send error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

