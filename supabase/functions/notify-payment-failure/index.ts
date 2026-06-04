import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// notify-payment-failure - email the practice admin, their reseller, and the
// super admin when a practice's subscription goes past_due / unpaid.
//
// Called server-to-server by chargebee-webhook with { practice_id } and a
// service-role bearer. Resolves contacts and sends via Mailgun. Best-effort: if Mailgun
// isn't configured it logs and returns ok:false rather than failing the webhook.
//
// The practice-facing email is white-labeled to the practice's reseller brand
// (see _shared/brand.ts); internal copies to the reseller owner + super admin
// stay CaseLift-branded and prefixed "[Internal]".
//
// Secrets: SUPABASE_SERVICE_ROLE_KEY, MAILGUN_API_KEY, MAILGUN_DOMAIN.
// Optional: MAILGUN_FROM (only the <noreply@domain> address is reused; the
//           display name is branded per-recipient),
//           APP_URL (defaults to https://app.caselift.io) for the billing link.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { type Brand, CASELIFT_BRAND, escapeHtml, renderBrandedEmail, resolveBrand } from "../_shared/brand.ts";
import { sendMailgunToMany } from "../_shared/mailgun.ts";

const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
    const appUrl = Deno.env.get("APP_URL") || "https://app.caselift.io";
    const billingUrl = `${appUrl}/settings/billing`;

    // Resolve the reseller brand for the practice-facing email.
    const brand = await resolveBrand(admin, practice);

    const buildEmail = (b: Brand) => {
      const subject = `Action required — payment issue with ${b.companyName}`;
      const text =
        `There was an issue with your payment.\n\n` +
        `We weren't able to process your last payment for ${name} on ${failedOn}. ` +
        `To keep your account active, please update your billing information.\n\n` +
        `Update payment method: ${billingUrl}\n\n` +
        `If you need help, reply to this email.`;
      const htmlBody = renderBrandedEmail(b, {
        heading: "There was an issue with your payment.",
        bodyHtml:
          `<p style="margin:0">We weren't able to process your last payment for ` +
          `<strong style="color:#e2e8f0">${escapeHtml(name)}</strong> on ${failedOn}. ` +
          `To keep your account active, please update your billing information.</p>`,
        button: { label: "Update Payment Method", url: billingUrl },
        footerNote: "If you need help, reply to this email.",
      });
      return { subject, text, htmlBody };
    };

    const results: Record<string, unknown> = {};

    // Practice-facing email: white-labeled to the reseller's brand when applicable.
    if (practice.email) {
      const { subject, text, htmlBody } = buildEmail(brand);
      results.practice = await sendMailgunToMany({
        to: [practice.email],
        subject,
        text,
        html: htmlBody,
        fromName: brand.fromName,
        replyTo: brand.supportEmail,
      });
    }

    // Internal copies (reseller owner + super admin) stay CaseLift-branded.
    const internal = [...new Set([resellerEmail, SUPER_ADMIN_EMAIL].filter(Boolean))] as string[];
    if (internal.length) {
      const { subject, text, htmlBody } = buildEmail(CASELIFT_BRAND);
      results.internal = await sendMailgunToMany({
        to: internal,
        subject: `[Internal] ${subject}`,
        text,
        html: htmlBody,
        fromName: CASELIFT_BRAND.fromName,
        replyTo: CASELIFT_BRAND.supportEmail,
      });
    }

    if (!practice.email && !internal.length) return json({ ok: true, sent: false, reason: "no recipients" });
    return json({ ok: true, white_labeled: brand.isWhiteLabeled, ...results });
  } catch (e) {
    await reportEdgeError("notify-payment-failure", e);
    console.error("notify-payment-failure error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
