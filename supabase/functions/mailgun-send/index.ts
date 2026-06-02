// ============================================================================
// mailgun-send - outbound sequence / transactional email via Mailgun.
// Called from send-due-messages and reactivation drip (service role).
// Secrets: MAILGUN_DOMAIN, MAILGUN_API_KEY; optional MAILGUN_FROM.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { resolveBrand } from "../_shared/brand.ts";
import { sendMailgunMessage } from "../_shared/mailgun.ts";

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
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const payload = (await req.json()) as Body;
    const to = String(payload.to || "").trim();
    const body = String(payload.body || "").trim();
    const subject = String(payload.subject || "Follow-up from your care team").trim();
    if (!to || !body) return json({ error: "Missing to or body." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let practiceId = payload.practice_id;
    if (!practiceId && payload.consult_id) {
      const { data: c } = await admin.from("consults").select("practice_id").eq("id", payload.consult_id).maybeSingle();
      practiceId = c?.practice_id;
    }

    let fromName = "Hope AI";
    let replyTo: string | null = null;
    if (practiceId) {
      const { data: pr } = await admin.from("practices").select("*, agency:agency_accounts(*)").eq("id", practiceId).maybeSingle();
      if (pr) {
        const brand = await resolveBrand(admin, pr);
        fromName = brand.companyName || pr?.name || fromName;
        replyTo = brand.supportEmail || null;
      }
    }

    const text = body;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111827;white-space:pre-wrap">${escapeHtml(body)}</div>`;

    const result = await sendMailgunMessage({ to, subject, text, html, fromName, replyTo });
    if (!result.sent) {
      return json({ error: result.reason, detail: result.detail }, result.reason === "mailgun_not_configured" ? 503 : 502);
    }

    return json({ ok: true, mailgun_id: result.id });
  } catch (e) {
    console.error("mailgun-send error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
