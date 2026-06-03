// ============================================================================
// reseller-signup - public, white-labeled client signup for a reseller's SaaS
// offer (the /signup/<reseller-slug> page).
//
// Flow (no caller JWT - this is a public endpoint, verify_jwt = false):
//   1. Resolve the reseller by reseller_slug. Must have SaaS mode configured
//      (reseller_client_price set), else 404.
//   2. Create the auth user with the chosen password (email pre-confirmed so the
//      client can be logged straight into the app). The on_auth_user_created
//      trigger provisions the public.users row.
//   3. Create the practice subaccount linked to the reseller via agency_id.
//      Trial resellers start the client on a 'trial' with trial_started_at /
//      trial_ends_at; otherwise the client is 'active' (payment is arranged
//      directly with the reseller, off-platform).
//   4. Link the user to the practice as owner.
//   5. Send a branded welcome email via Mailgun using the reseller's brand.
//
// The frontend signs the client in with the same email/password after a 200.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAILGUN_DOMAIN, MAILGUN_API_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { type Brand, emailFooter, emailHeader, emailSignature, resolveBrand } from "../_shared/brand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendMailgun(
  to: string,
  subject: string,
  html: string,
  text: string,
  fromName: string,
  replyTo: string | null,
) {
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  const key = Deno.env.get("MAILGUN_API_KEY");
  if (!domain || !key) {
    console.warn("reseller-signup: MAILGUN not configured - skipping welcome email");
    return { sent: false };
  }
  const envFrom = Deno.env.get("MAILGUN_FROM");
  const address = envFrom?.match(/<([^>]+)>/)?.[1] || `noreply@${domain}`;
  const form = new FormData();
  form.append("from", `${fromName} <${address}>`);
  form.append("to", to);
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
    console.error(`reseller-signup Mailgun send failed ${res.status}:`, await res.text());
    return { sent: false };
  }
  return { sent: true };
}

function buildWelcomeEmail(brand: Brand, practiceName: string, appUrl: string, trialDays: number | null) {
  const subject = `Welcome to ${brand.companyName} - meet CaseLift`;
  const trialLine = trialDays
    ? `Your ${trialDays}-day free trial has started - no payment required today.`
    : `Your account is ready to go.`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">
      <div style="margin-bottom:20px">${emailHeader(brand)}</div>
      <h1 style="font-size:20px;margin:0 0 12px">Welcome to ${escapeHtml(brand.companyName)} - meet CaseLift</h1>
      <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 20px">
        Hi - I'm CaseLift, your AI assistant at ${escapeHtml(practiceName)}. I listen to your consults,
        follow up with patients, and recover more high-value cases for you. ${escapeHtml(trialLine)}
      </p>
      <a href="${appUrl}" style="display:inline-block;background:${brand.primaryColor};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px">
        Open ${escapeHtml(brand.companyName)}
      </a>
      <p style="font-size:12px;color:#6b7280;margin:20px 0 0">
        Questions? Reach us at <a href="mailto:${brand.supportEmail}" style="color:${brand.primaryColor}">${brand.supportEmail}</a>.
      </p>
      ${emailSignature(brand)}
      ${emailFooter(brand)}
    </div>`;
  const text =
    `Welcome to ${brand.companyName} - meet CaseLift.\n\n` +
    `I'm CaseLift, your AI assistant at ${practiceName}. ${trialLine}\n\nOpen the app: ${appUrl}\n\n` +
    `Questions? Email ${brand.supportEmail}`;
  return { subject, html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const slug: string | undefined = (body.slug || "").trim() || undefined;
    const practiceName: string | undefined = (body.practice_name || "").trim() || undefined;
    const firstName: string = (body.first_name || "").trim();
    const lastName: string = (body.last_name || "").trim();
    const email: string | undefined = (body.email || "").trim().toLowerCase() || undefined;
    const phone: string | null = (body.phone || "").trim() || null;
    const password: string | undefined = body.password;

    if (!slug) return json({ error: "Missing reseller slug" }, 400);
    if (!practiceName || !email || !password) {
      return json({ error: "Practice name, email, and password are required" }, 400);
    }
    if (String(password).length < 6) {
      return json({ error: "Password must be at least 6 characters" }, 400);
    }

    // --- 1) Resolve the reseller + their SaaS offer. ---
    const { data: agency, error: agencyErr } = await admin
      .from("agency_accounts")
      .select("id, reseller_client_price, reseller_trial_enabled, reseller_trial_days, status, active")
      .eq("reseller_slug", slug)
      .maybeSingle();
    if (agencyErr) throw agencyErr;
    if (!agency || agency.reseller_client_price == null) {
      return json({ error: "This signup link isn't active." }, 404);
    }

    const trialEnabled = agency.reseller_trial_enabled === true && Number(agency.reseller_trial_days) > 0;
    const trialDays = trialEnabled ? Number(agency.reseller_trial_days) : 0;

    // --- 2) Create the auth user (email pre-confirmed for immediate login). ---
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { practice_name: practiceName, first_name: firstName, last_name: lastName },
    });
    if (createErr || !created?.user) {
      // Most common: the email already has an account.
      const msg = createErr?.message || "Could not create your account";
      const exists = /already.+registered|already been registered|exists/i.test(msg);
      return json({ error: exists ? "An account with this email already exists. Please sign in." : msg }, exists ? 409 : 400);
    }
    const userId = created.user.id;

    // --- 3) Create the practice subaccount under the reseller. ---
    const now = new Date();
    const trialEndsAt = trialEnabled
      ? new Date(now.getTime() + trialDays * 86_400_000).toISOString()
      : null;
    const practiceRow: Record<string, unknown> = {
      name: practiceName,
      doctor_first: firstName || null,
      doctor_last: lastName || null,
      email,
      phone,
      agency_id: agency.id,
      subscription_status: trialEnabled ? "trial" : "active",
      trial_started_at: trialEnabled ? now.toISOString() : null,
      trial_ends_at: trialEndsAt,
    };
    const { data: practice, error: practiceErr } = await admin
      .from("practices")
      .insert(practiceRow)
      .select("id")
      .single();
    if (practiceErr) {
      // Roll back the orphaned auth user so the client can retry cleanly.
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      throw practiceErr;
    }
    const practiceId = practice.id;

    // --- 4) Link the user to the practice as owner. ---
    await admin
      .from("users")
      .upsert({ id: userId, email, practice_id: practiceId, role: "owner" }, { onConflict: "id" });

    // --- 5) Branded welcome email (best-effort). ---
    const appUrl = (body.app_url || Deno.env.get("APP_URL") || "https://app.caselift.io").replace(/\/$/, "");
    const brand = await resolveBrand(admin, { agency_id: agency.id });
    const { subject, html, text } = buildWelcomeEmail(brand, practiceName, appUrl, trialEnabled ? trialDays : null);
    const sent = await sendMailgun(email, subject, html, text, brand.fromName, brand.supportEmail);

    return json({
      practice_id: practiceId,
      user_id: userId,
      subscription_status: trialEnabled ? "trial" : "active",
      trial_ends_at: trialEndsAt,
      email_sent: sent.sent === true,
    });
  } catch (e) {
    console.error("reseller-signup error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
