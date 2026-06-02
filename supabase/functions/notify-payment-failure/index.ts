// ============================================================================
// notify-payment-failure - email the practice admin, their reseller, and the
// super admin when a practice's subscription goes past_due / unpaid.
//
// Called server-to-server by ls-webhook with { practice_id } and a service-role
// bearer. Resolves contacts and sends via Mailgun. Best-effort: if Mailgun
// isn't configured it logs and returns ok:false rather than failing the webhook.
//
// The practice-facing email is white-labeled to the practice's reseller brand
// (see _shared/brand.ts); internal copies to the reseller owner + super admin
// stay Hope AI-branded and prefixed "[Internal]".
//
// Secrets: SUPABASE_SERVICE_ROLE_KEY, MAILGUN_API_KEY, MAILGUN_DOMAIN.
// Optional: MAILGUN_FROM (only the <noreply@domain> address is reused; the
//           display name is branded per-recipient),
//           APP_URL (defaults to https://app.heyhope.ai) for the billing link.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { type Brand, CONSULTIQ_BRAND, emailFooter, emailHeader, emailSignature, resolveBrand } from "../_shared/brand.ts";

const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// `replyTo` overrides the brand support email when set; the noreply@domain
// "from" address is kept and only the display name is branded.
async function sendMailgun(
  to: string[],
  subject: string,
  html: string,
  text: string,
  fromName: string,
  replyTo: string | null,
) {
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  const key = Deno.env.get("MAILGUN_API_KEY");
  if (!domain || !key) {
    console.warn("notify-payment-failure: MAILGUN_DOMAIN/MAILGUN_API_KEY not set - skipping email send");
    return { sent: false, reason: "mailgun_not_configured" };
  }
  // Keep the existing noreply@domain address; only the display name is branded.
  const envFrom = Deno.env.get("MAILGUN_FROM");
  const address = envFrom?.match(/<([^>]+)>/)?.[1] || `noreply@${domain}`;
  const from = `${fromName} <${address}>`;
  const form = new FormData();
  form.append("from", from);
  for (const addr of to) form.append("to", addr);
  form.append("subject", subject);
  form.append("text", text);
  form.append("html", html);
  if (replyTo) form.append("h:Reply-To", replyTo);

  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`api:${key}`)}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`Mailgun send failed ${res.status}:`, detail);
    return { sent: false, reason: `mailgun_${res.status}` };
  }
  return { sent: true };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const practiceId: string | undefined = body.practice_id;
    if (!practiceId) return json({ error: "Missing 'practice_id'" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Practice + its reseller (agency) owner email.
    const { data: practice } = await admin
      .from("practices")
      .select("id, name, email, agency_id")
      .eq("id", practiceId)
      .maybeSingle();
    if (!practice) return json({ error: "Practice not found" }, 404);

    let resellerEmail: string | null = null;
    if (practice.agency_id) {
      const { data: agency } = await admin
        .from("agency_accounts")
        .select("owner_email")
        .eq("id", practice.agency_id)
        .maybeSingle();
      resellerEmail = agency?.owner_email ?? null;
    }

    const name = practice.name || "your practice";
    const failedOn = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const appUrl = Deno.env.get("APP_URL") || "https://app.heyhope.ai";
    const billingUrl = `${appUrl}/settings/billing`;

    // Resolve the reseller brand for the practice-facing email.
    const brand = await resolveBrand(admin, practice);

    const buildEmail = (b: Brand) => {
      const subject = `Action required: payment failed for ${name}`;
      const text =
        `A subscription payment failed for ${name} on ${failedOn}.\n\n` +
        `Access will be paused until the payment method is updated.\n` +
        `Update payment method: ${billingUrl}\n\n` +
        `The ${b.companyName} Team`;
      const htmlBody =
        `<div style="font-family:Inter,Arial,sans-serif;color:#1f2937">` +
        `<div style="margin-bottom:16px">${emailHeader(b)}</div>` +
        `<p>A subscription payment failed for <strong>${name}</strong> on ${failedOn}.</p>` +
        `<p>Access will be paused until the payment method is updated.</p>` +
        `<p><a href="${billingUrl}" style="color:${b.primaryColor}">Update payment method</a></p>` +
        emailSignature(b) +
        emailFooter(b) +
        `</div>`;
      return { subject, text, htmlBody };
    };

    const results: Record<string, unknown> = {};

    // Practice-facing email: white-labeled to the reseller's brand when applicable.
    if (practice.email) {
      const { subject, text, htmlBody } = buildEmail(brand);
      results.practice = await sendMailgun([practice.email], subject, htmlBody, text, brand.fromName, brand.supportEmail);
    }

    // Internal copies (reseller owner + super admin) stay Hope AI-branded.
    const internal = [...new Set([resellerEmail, SUPER_ADMIN_EMAIL].filter(Boolean))] as string[];
    if (internal.length) {
      const { subject, text, htmlBody } = buildEmail(CONSULTIQ_BRAND);
      results.internal = await sendMailgun(
        internal,
        `[Internal] ${subject}`,
        htmlBody,
        text,
        CONSULTIQ_BRAND.fromName,
        CONSULTIQ_BRAND.supportEmail,
      );
    }

    if (!practice.email && !internal.length) return json({ ok: true, sent: false, reason: "no recipients" });
    return json({ ok: true, white_labeled: brand.isWhiteLabeled, ...results });
  } catch (e) {
    console.error("notify-payment-failure error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
