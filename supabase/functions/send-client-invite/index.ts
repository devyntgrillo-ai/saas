import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// send-client-invite - reseller / super-admin onboarding of a new client
// practice.
//
// Flow:
//   1. Authenticate the caller (JWT) and authorize: must be a super admin, or an
//      owner/admin of a reseller (agency_accounts via agency_members).
//   2. Create the practice record under the caller's reseller in an "invited"
//      lifecycle state, carrying the owner's contact details, the reseller's
//      price, and a one-time invite_token.
//   3. Generate a Supabase magic invite link server-side.
//   4. Email it via Mailgun using the reseller's white-label brand (logo header,
//      company name, the practice's price, a "Get Started" button, "Powered by
//      CaseLift" footer). Falls back to returning the link if Mailgun isn't
//      configured.
//
// Uses the service role for admin auth + privileged writes; the caller's own JWT
// is used only to authenticate and authorize them.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { type Brand, escapeHtml, renderBrandedEmail, resolveBrand } from "../_shared/brand.ts";
import { acceptInviteRedirectUrl } from "../_shared/invite.ts";
import { sendMailgunMessage } from "../_shared/mailgun.ts";
import { isSuperAdminUser } from "../_shared/admin.ts";

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

function formatPrice(price: number | null): string | null {
  if (price == null || Number.isNaN(price)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
  }).format(price);
}

// White-labeled invite email built around the reseller brand, with the practice's
// price and a "Get Started" button pointing at the magic link.
function buildInviteEmail(
  brand: Brand,
  ownerName: string | null,
  practiceName: string,
  price: number | null,
  inviteLink: string,
) {
  const subject = `You're invited to ${brand.companyName}`;
  const greeting = ownerName ? `Hi ${escapeHtml(ownerName)},` : "Hello,";
  const priceLabel = formatPrice(price);
  const priceBlock = priceLabel
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td style="background:#0f1117;border:1px solid #2a3142;border-radius:8px;padding:14px 16px">
         <p style="color:#64748b;font-size:12px;margin:0 0 2px">Your plan</p>
         <p style="color:#ffffff;font-size:18px;font-weight:700;margin:0">${priceLabel}<span style="color:#94a3b8;font-size:13px;font-weight:500"> / month</span></p>
       </td></tr></table>`
    : "";
  const bodyHtml =
    `<p style="margin:0 0 16px">${greeting}</p>` +
    `<p style="margin:0">Your ${escapeHtml(brand.companyName)} account for <strong style="color:#e2e8f0">${escapeHtml(practiceName)}</strong> is ready. ` +
    `Click below to set up your account and get started.</p>` +
    priceBlock;
  const html = renderBrandedEmail(brand, {
    heading: `You're invited to ${brand.companyName}`,
    bodyHtml,
    button: { label: "Get Started", url: inviteLink },
    footerNote:
      `If the button doesn't work, paste this link into your browser:<br />` +
      `<span style="color:#64748b;word-break:break-all">${escapeHtml(inviteLink)}</span>`,
  });
  const text =
    `${ownerName ? `Hi ${ownerName},\n\n` : ""}` +
    `Your ${brand.companyName} account for ${practiceName} is ready.\n\n` +
    `${priceLabel ? `Your plan: ${priceLabel} / month\n\n` : ""}` +
    `Get started: ${inviteLink}`;
  return { subject, html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // Caller identity (RLS-scoped).
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const practiceName: string | undefined = body.practice_name;
    const ownerName: string | null = body.owner_name ?? null;
    const ownerEmail: string | undefined = body.owner_email;
    const phone: string | null = body.phone ?? null;
    const city: string | null = body.city ?? null;
    const state: string | null = body.state ?? null;
    const pmsType: string | null = body.pms_type ?? null;
    const resellerPrice: number | null =
      body.reseller_price === undefined || body.reseller_price === null || body.reseller_price === ""
        ? null
        : Number(body.reseller_price);

    if (!practiceName || !ownerEmail) {
      return json({ error: "practice_name and owner_email are required" }, 400);
    }
    if (resellerPrice != null && Number.isNaN(resellerPrice)) {
      return json({ error: "reseller_price must be a number" }, 400);
    }

    // Service-role client for admin + privileged writes.
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // --- 1) Authorize: super admin, or owner/admin of a reseller. ---
    const { data: profile } = await admin
      .from("users")
      .select("access_level")
      .eq("id", user.id)
      .maybeSingle();
    const isSuperAdmin = isSuperAdminUser(user, profile?.access_level);

    // The caller's reseller (owner/admin membership). Drives branding + agency_id.
    const { data: membership } = await admin
      .from("agency_members")
      .select("agency_id, role")
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!isSuperAdmin && !membership) {
      return json({ error: "Only resellers or super admins can invite client practices." }, 403);
    }

    // Super admins may target a specific reseller via body.agency_id; otherwise
    // the practice is attached to the caller's own reseller (may be null for a
    // super admin acting directly, which falls back to the CaseLift brand).
    const agencyId: string | null =
      (isSuperAdmin && body.agency_id) || membership?.agency_id || null;

    // --- 2) Create the invited practice. ---
    const inviteToken = crypto.randomUUID();
    const { data: practice, error: practiceErr } = await admin
      .from("practices")
      .insert({
        name: practiceName,
        owner_name: ownerName,
        owner_email: ownerEmail,
        email: ownerEmail,
        phone,
        city,
        state,
        pms_type: pmsType,
        reseller_price: resellerPrice,
        agency_id: agencyId,
        status: "invited",
        invited_at: new Date().toISOString(),
        invite_token: inviteToken,
      })
      .select("id")
      .single();
    if (practiceErr) throw practiceErr;
    const practiceId = practice.id;

    // --- 3) Generate a shareable link, then email it. Prefer "invite"; fall back
    //         to magiclink when the email already belongs to an auth user. ---
    const redirectTo = acceptInviteRedirectUrl();
    async function makeLink(type: "invite" | "magiclink") {
      const { data, error } = await admin.auth.admin.generateLink({
        type,
        email: ownerEmail,
        options: { redirectTo },
      });
      if (error) console.warn(`send-client-invite: generateLink(${type}) failed:`, error.message);
      return error || !data?.properties?.action_link ? null : data;
    }
    const linkData = (await makeLink("invite")) ?? (await makeLink("magiclink"));
    if (!linkData) {
      // The practice was created; surface a partial success so the caller can retry.
      return json(
        {
          practice_id: practiceId,
          invite_token: inviteToken,
          warning: "Practice created, but an invite link could not be generated. Resend the invite from the practice list.",
        },
        207,
      );
    }
    const invitedUserId: string | null = linkData.user?.id ?? null;
    const inviteLink: string = linkData.properties.action_link;

    // --- 4) Email the branded invite via Mailgun. ---
    const brand = await resolveBrand(admin, { agency_id: agencyId });
    const { subject, html, text } = buildInviteEmail(
      brand,
      ownerName,
      practiceName,
      resellerPrice,
      inviteLink,
    );
    const sendResult = await sendMailgunMessage({
      to: ownerEmail,
      subject,
      text,
      html,
      fromName: brand.fromName,
      replyTo: brand.supportEmail,
    });

    // Link the invited auth user to the new practice as its owner.
    if (invitedUserId) {
      await admin
        .from("users")
        .upsert(
          { id: invitedUserId, email: ownerEmail, practice_id: practiceId, role: "owner" },
          { onConflict: "id" },
        );
    }

    return json({
      practice_id: practiceId,
      invite_token: inviteToken,
      invited_user_id: invitedUserId,
      status: "invited",
      email_sent: sendResult.sent === true,
      // When Mailgun isn't configured, hand back the link so the caller can share it.
      invite_link: sendResult.sent === true ? null : inviteLink,
    });
  } catch (e) {
    await reportEdgeError("send-client-invite", e);
    console.error("send-client-invite error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
