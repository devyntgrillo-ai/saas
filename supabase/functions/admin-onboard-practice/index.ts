import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// admin-onboard-practice — super-admin "close the deal on a sales call" flow.
//
// A rep, live on a demo, charges the customer's card (or starts a trial) and
// provisions their account in one call. The card is tokenized client-side by
// Helcim.js (HelcimCardForm); this function VERIFIES the charge server-side,
// enrolls recurring billing, creates the practice + owner login, and emails a
// welcome message with a set-password link + a temp password fallback.
//
// Self-contained on purpose: it does NOT reuse helcim-checkout's record_payment
// /start_trial because those are caller-scoped (they act on the *caller's* own
// practice). Here the caller is the rep, so we mirror the verify/subscribe logic
// against the freshly-created practice. Because the caller is a trusted
// super-admin, the amount is trusted as-is (no ALLOWED_AMOUNTS clamp).
//
// Secrets: HELCIM_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
//          SUPABASE_SERVICE_ROLE_KEY, MAILGUN_*, APP_URL, HELCIM_TEST_MODE.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { renderBrandedEmail, resolveBrand } from "../_shared/brand.ts";
import { sendMailgunMessage } from "../_shared/mailgun.ts";
import { recordAuditFromReq } from "../_shared/audit.ts";
import { appBaseUrl } from "../_shared/appUrl.ts";

const HELCIM_API_KEY = Deno.env.get("HELCIM_API_KEY");
const HELCIM_BASE = "https://api.helcim.com/v2";
const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function helcim(endpoint: string, method = "GET", body?: object) {
  const res = await fetch(`${HELCIM_BASE}${endpoint}`, {
    method,
    headers: { "api-token": HELCIM_API_KEY!, "Content-Type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ± 1 day YYYY-MM-DD window around the Helcim.js transaction date (scopes the
// verification lookup; Helcim's date filters are inclusive).
function dayWindow(dateStr?: string): { dateFrom: string; dateTo: string } {
  const base = dateStr && !isNaN(Date.parse(dateStr)) ? new Date(dateStr) : new Date();
  const day = (n: number) => new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return { dateFrom: day(-1), dateTo: day(1) };
}

// Human-readable but strong temp password (≥ 6 chars, the Supabase minimum).
function genTempPassword(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=il0O1]/g, "");
  return `CL-${b64.slice(0, 10)}`;
}

// deno-lint-ignore no-explicit-any
function escapeHtml(s: any): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Enroll a Helcim recurring subscription on the customer (best-effort). The
// recurringAmount is the trusted amount; the payment-plan is matched by amount
// with a fallback to the first plan (its cadence carries the custom amount).
async function enrollSubscription(
  customerCode: string | null,
  amount: number,
  dateActivated?: string,
): Promise<string | null> {
  if (!customerCode) return null;
  try {
    const plansRes = await helcim(`/payment-plans`);
    const plans = Array.isArray(plansRes.data) ? plansRes.data : (plansRes.data?.data ?? []);
    const plan = plans.find((p: Record<string, unknown>) => Math.round(Number(p.recurringAmount)) === Math.round(amount)) || plans[0];
    if (!plan?.id) {
      console.error(`admin-onboard: no Helcim $${amount}/mo recurring plan found — activating without a subscription.`);
      return null;
    }
    const idem = crypto.randomUUID().replace(/-/g, "").slice(0, 25); // Helcim requires exactly 25 chars
    const sub: Record<string, unknown> = { customerCode, paymentPlanId: plan.id, recurringAmount: amount, paymentMethod: "card" };
    if (dateActivated) sub.dateActivated = dateActivated;
    const subRes = await fetch(`${HELCIM_BASE}/subscriptions`, {
      method: "POST",
      headers: { "api-token": HELCIM_API_KEY!, "idempotency-key": idem, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ subscriptions: [sub] }),
    });
    const subData = await subRes.json().catch(() => ({}));
    const created = Array.isArray(subData) ? subData[0] : (subData?.data?.[0] ?? subData?.[0] ?? subData);
    return (created?.id ?? created?.subscriptionId) || null;
  } catch (e) {
    console.error("admin-onboard: subscription enrollment failed:", (e as Error)?.message);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!HELCIM_API_KEY) return json({ error: "Helcim is not configured (missing HELCIM_API_KEY secret)." }, 503);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // --- Gate: super-admin only (by access_level or the SA email). ---
    const { data: me } = await admin.from("users").select("access_level").eq("id", user.id).maybeSingle();
    const isSuper = me?.access_level === "super_admin" || (user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
    if (!isSuper) return json({ error: "Super-admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const practiceName = String(body.practice_name || "").trim();
    const ownerName = String(body.owner_name || "").trim();
    const ownerEmail = String(body.owner_email || "").trim().toLowerCase();
    const ownerPhone = body.owner_phone ? String(body.owner_phone).trim() : null;
    const mode = body.mode === "trial" ? "trial" : "charge";
    const cardToken = String(body.card_token || "");
    const customerCode = (body.customer_code ? String(body.customer_code) : null);
    const cardType = body.card_type ? String(body.card_type) : null;
    const last4 = String(body.card_last4 || "").replace(/\D/g, "").slice(-4) || null;

    // Validate inputs.
    if (!practiceName) return json({ error: "Practice name is required." }, 400);
    if (!ownerName) return json({ error: "Owner name is required." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) return json({ error: "A valid owner email is required." }, 400);
    if (!cardToken) return json({ error: "Missing card token — the card was not captured." }, 400);

    const amount = Math.round(Number(body.amount));
    const trialDays = mode === "trial" ? Math.round(Number(body.trial_days)) : 0;
    const trialAmount = mode === "trial" ? Math.round(Number(body.trial_amount)) : 0;
    if (mode === "charge") {
      if (!(amount > 0 && amount <= 100000)) return json({ error: "Enter a charge amount between $1 and $100,000." }, 400);
    } else {
      if (!(trialDays > 0 && trialDays <= 365)) return json({ error: "Enter a trial length between 1 and 365 days." }, 400);
      if (!(trialAmount > 0 && trialAmount <= 100000)) return json({ error: "Enter a post-trial monthly amount between $1 and $100,000." }, 400);
    }

    // The recurring price + the stored plan amount.
    const planAmount = mode === "trial" ? trialAmount : amount;

    // Refuse to hijack an existing account.
    const { data: existing } = await admin.from("users").select("id").eq("email", ownerEmail).maybeSingle();
    if (existing?.id) return json({ error: "That email already has an account. Use the admin Users tab to manage it." }, 409);

    const TEST_MODE = Deno.env.get("HELCIM_TEST_MODE") === "true";

    // 1) CHARGE MODE: verify the APPROVED charge with Helcim BEFORE creating
    //    anything, so a failed charge never leaves an orphan account. (Trial mode
    //    has no charge to verify — the card was tokenized at $0.)
    let realTxnId: string | null = null;
    let resolvedCustomerCode = customerCode;
    if (mode === "charge") {
      const { dateFrom, dateTo } = dayWindow(body.date);
      const qs = new URLSearchParams({ cardToken, dateFrom, dateTo });
      const txnRes = await helcim(`/card-transactions?${qs.toString()}`);
      const list = Array.isArray(txnRes.data) ? txnRes.data : (txnRes.data?.data ?? []);
      const approved = list.filter((t: Record<string, unknown>) => String(t.status ?? "").toUpperCase() === "APPROVED");
      const match = approved.find((t: Record<string, unknown>) => Math.round(Number(t.amount)) === Math.round(amount))
        || approved.find((t: Record<string, unknown>) => String(t.cardToken ?? "") === cardToken);
      // Test-mode Helcim.js charges are sandboxed and never appear in the live v2
      // API, so there's nothing to verify against — trust the client result so a
      // demo can complete. Production keeps strict server-side verification.
      if (!match && !TEST_MODE) {
        console.error("admin-onboard verify failed:", JSON.stringify({ helcimStatus: txnRes.status, count: Array.isArray(list) ? list.length : 0, amount }));
        return json({ error: "We could not verify an approved charge on this card. The card may have declined — try again." }, 400);
      }
      if (!match) console.warn("admin-onboard: TEST MODE — no live transaction to verify; trusting client result.");
      realTxnId = (match?.transactionId ?? match?.id ?? body.transaction_id) || null;
      resolvedCustomerCode = (match?.customerCode || customerCode) || null;
    }

    // 2) Create the practice (resume the onboarding wizard at the BAA step).
    const parts = ownerName.split(/\s+/);
    const doctorFirst = parts[0] || null;
    const doctorLast = parts.slice(1).join(" ") || null;
    const { data: practice, error: prErr } = await admin.from("practices").insert({
      name: practiceName,
      email: ownerEmail,
      phone: ownerPhone,
      doctor_first: doctorFirst,
      doctor_last: doctorLast,
      plan_amount: planAmount,
      onboarding_step: 2, // ['account','payment','baa',...] → open at BAA
      onboarding_completed: false,
    }).select("id").single();
    if (prErr || !practice?.id) return json({ error: `Could not create the practice: ${prErr?.message || "unknown error"}` }, 500);
    const practiceId = practice.id as string;

    // 3) Enroll recurring billing + activate the practice.
    const patch: Record<string, unknown> = {
      helcim_card_token: cardToken,
      helcim_customer_code: resolvedCustomerCode,
      card_last4: last4,
      card_type: cardType,
      plan_amount: planAmount,
    };
    if (mode === "charge") {
      const subscriptionId = await enrollSubscription(resolvedCustomerCode, amount);
      patch.subscription_status = "active";
      patch.billing_status = "active";
      patch.helcim_transaction_id = realTxnId;
      if (subscriptionId) patch.helcim_subscription_id = subscriptionId;
    } else {
      const trialEndsAt = new Date(Date.now() + trialDays * 86_400_000);
      const subscriptionId = await enrollSubscription(resolvedCustomerCode, trialAmount, trialEndsAt.toISOString().slice(0, 10));
      patch.subscription_status = "trial";
      patch.trial_ends_at = trialEndsAt.toISOString();
      patch.next_billing_date = trialEndsAt.toISOString();
      if (subscriptionId) patch.helcim_subscription_id = subscriptionId;
    }
    const { error: upErr } = await admin.from("practices").update(patch).eq("id", practiceId);
    if (upErr) return json({ error: `Charged the card but could not activate the account: ${upErr.message}` }, 500);

    // 4) Create the owner login. email_confirm:true so they can sign in
    //    immediately with the temp password; the handle_new_user trigger inserts
    //    the public.users row (role 'owner') which we then scope to the practice.
    const tempPassword = genTempPassword();
    const { data: created, error: cuErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { practice_name: practiceName },
    });
    const ownerUserId = created?.user?.id;
    if (cuErr || !ownerUserId) {
      // Charge + practice succeeded; the login didn't. Surface a partial success so
      // the rep can retry user creation without re-charging.
      return json({
        ok: false,
        partial: true,
        practice_id: practiceId,
        error: `Payment captured and practice created, but the owner login could not be created: ${cuErr?.message || "unknown error"}. Contact support to finish provisioning.`,
      }, 502);
    }
    await admin.from("users").upsert(
      { id: ownerUserId, email: ownerEmail, access_level: "practice_owner", role: "owner", practice_id: practiceId },
      { onConflict: "id" },
    );

    // 5) Welcome email: set-password link + temp-password fallback + next steps.
    const redirectTo = `${appBaseUrl()}/accept-invite?type=recovery&next=${encodeURIComponent("/onboarding")}`;
    let loginLink = `${appBaseUrl()}/login`;
    try {
      const { data: linkData } = await admin.auth.admin.generateLink({ type: "recovery", email: ownerEmail, options: { redirectTo } });
      if (linkData?.properties?.action_link) loginLink = linkData.properties.action_link as string;
    } catch (e) {
      console.error("admin-onboard: generateLink failed:", (e as Error)?.message);
    }

    const brand = await resolveBrand(admin, null); // direct CaseLift practice → CaseLift brand
    const firstName = doctorFirst || "there";
    const priceLine = mode === "trial"
      ? `${trialDays}-day free trial, then $${trialAmount.toLocaleString()}/month.`
      : `$${amount.toLocaleString()}/month.`;
    const html = renderBrandedEmail(brand, {
      heading: `Welcome to ${brand.companyName}, ${escapeHtml(firstName)}!`,
      bodyHtml:
        `<p style="margin:0 0 12px">Your ${brand.companyName} account for <strong>${escapeHtml(practiceName)}</strong> is ready. ` +
        `Set your password below, then finish a few quick steps to get going.</p>` +
        `<p style="margin:0 0 6px;color:#cbd5e1"><strong>After you log in:</strong></p>` +
        `<ol style="margin:0;padding-left:18px;color:#94a3b8;line-height:1.7">` +
        `<li>Sign your HIPAA Business Associate Agreement</li>` +
        `<li>Confirm your practice details</li>` +
        `<li>Invite your team</li>` +
        `<li>See how ${brand.companyName} works</li>` +
        `</ol>`,
      button: { label: "Set your password & finish setup", url: loginLink },
      subtext: `Prefer to log in right now? Use this temporary password at ${appBaseUrl()}/login &mdash; <strong>${escapeHtml(tempPassword)}</strong> (you'll be asked to choose a new one).`,
      footerNote: priceLine,
    });
    const text =
      `Welcome to ${brand.companyName}, ${firstName}!\n\n` +
      `Your account for ${practiceName} is ready.\n\n` +
      `Set your password & finish setup: ${loginLink}\n\n` +
      `Or log in now at ${appBaseUrl()}/login with this temporary password: ${tempPassword}\n\n` +
      `After you log in: 1) Sign your HIPAA BAA, 2) Confirm practice details, 3) Invite your team, 4) See how it works.\n\n` +
      priceLine;
    let emailSent = false;
    try {
      const r = await sendMailgunMessage({
        to: ownerEmail,
        subject: `Welcome to ${brand.companyName} — your account is ready`,
        text,
        html,
        fromName: brand.fromName,
        replyTo: brand.supportEmail,
      });
      emailSent = r.sent === true;
    } catch (e) {
      console.error("admin-onboard: welcome email failed:", (e as Error)?.message);
    }

    // 6) Best-effort: internal Slack alert + audit trail.
    admin.functions.invoke("notify-signup", { body: { practice_id: practiceId } }).catch(() => {});
    await recordAuditFromReq(admin, req, {
      action: "practice.provisioned",
      userId: user.id,
      userEmail: user.email ?? null,
      practiceId,
      resourceType: "practice",
      resourceId: practiceId,
      details: { mode, plan_amount: planAmount, trial_days: trialDays || null, owner_email: ownerEmail, email_sent: emailSent },
    });

    return json({
      ok: true,
      practice_id: practiceId,
      owner_email: ownerEmail,
      temp_password: tempPassword,
      login_link: loginLink,
      email_sent: emailSent,
      mode,
      plan_amount: planAmount,
      trial_days: trialDays || null,
    });
  } catch (e) {
    await reportEdgeError("admin-onboard-practice", e);
    console.error("admin-onboard-practice error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
