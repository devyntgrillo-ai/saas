// ============================================================================
// mailgun-send - outbound PATIENT email via per-practice Mailgun subdomain.
// Conversations, send-due-messages, reactivation drip. Platform mail (invites,
// digests) uses sendMailgunMessage with audience platform in other functions.
//
// Secrets: MAILGUN_API_KEY, MAILGUN_PATIENT_MAIL_DOMAIN, MAILGUN_PATIENT_MAIL_ROOT
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { resolveBrand } from "../_shared/brand.ts";
import {
  isPatientMailConfigured,
  mailgunFromAddress,
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

    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isServiceRole = Boolean(bearer && (bearer === serviceKey || jwtRole(bearer) === "service_role"));
    if (!isServiceRole && authHeader) {
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
      if (prof?.practice_id !== practiceId) return json({ error: "Forbidden" }, 403);
    }

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
    const fromName = pr.email_from_name || brand.companyName || pr.name || "Hope AI";

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

    const inboundReply = conversationId
      ? conversationReplyOnPracticeHost(conversationId, mail.hostname)
      : null;
    const replyTo = inboundReply || pr.email_reply_to || brand.supportEmail || null;

    const text = body;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111827;white-space:pre-wrap">${escapeHtml(body)}</div>`;

    const platformFrom = mailgunFromAddress("noreply");
    const platformDomain = mailgunPlatformDomain();
    const deliverViaPlatform = Deno.env.get("MAILGUN_PATIENT_DELIVER_VIA_PLATFORM") !== "false";
    const patientApiDomain = mail.apiDomain;
    const patientApiReady = patientApiDomain &&
      platformDomain &&
      patientApiDomain.toLowerCase() !== platformDomain.toLowerCase();

    let result: Awaited<ReturnType<typeof sendMailgunMessage>>;
    let usedFallback = false;

    // Sandbox / single-domain Mailgun: send via verified MAILGUN_DOMAIN (From @mg…).
    // Per-practice From (office@sub.mail…) requires wildcard mail.heyhope.ai in Mailgun.
    if (deliverViaPlatform && platformFrom && platformDomain) {
      const platformReply = conversationId
        ? conversationReplyOnPracticeHost(conversationId, platformDomain)
        : replyTo;
      result = await sendMailgunMessage({
        to,
        subject,
        text,
        html,
        fromName,
        replyTo: platformReply,
        fromAddress: platformFrom,
        audience: "platform",
        mailgunDomain: platformDomain,
      });
      usedFallback = true;
    } else if (patientApiReady) {
      result = await sendMailgunMessage({
        to,
        subject,
        text,
        html,
        fromName,
        replyTo,
        fromAddress: mail.fromAddress,
        audience: "patient",
        mailgunDomain: patientApiDomain,
      });
      if (
        !result.sent &&
        platformFrom &&
        platformDomain &&
        (result.reason === "mailgun_401" || result.reason === "mailgun_403" || result.reason === "mailgun_404")
      ) {
        console.warn(`mailgun-send: patient domain failed (${result.reason}); trying ${platformDomain}`);
        const platformReply = conversationId
          ? conversationReplyOnPracticeHost(conversationId, platformDomain)
          : replyTo;
        result = await sendMailgunMessage({
          to,
          subject,
          text,
          html,
          fromName,
          replyTo: platformReply,
          fromAddress: platformFrom,
          audience: "platform",
          mailgunDomain: platformDomain,
        });
        usedFallback = result.sent;
      }
    } else {
      result = await sendMailgunMessage({
        to,
        subject,
        text,
        html,
        fromName,
        replyTo,
        fromAddress: mail.fromAddress,
        audience: "patient",
        mailgunDomain: patientApiDomain,
      });
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
          reply_to: inboundReply || replyTo,
          from_address: mail.fromAddress,
          mail_subdomain: mail.subdomain,
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
      from_address: usedFallback ? mailgunFromAddress("noreply") : mail.fromAddress,
      mail_subdomain: mail.subdomain,
      used_platform_fallback: usedFallback,
    });
  } catch (e) {
    console.error("mailgun-send error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function jwtRole(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
