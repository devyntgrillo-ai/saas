import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// invite-practice-user - agency onboarding of a new client practice + its TC.
//
// Flow:
//   1. Verify the caller is an owner/admin of the target agency.
//   2. Create the practice record under that agency (service role).
//   3. Generate a Supabase magic invite link server-side and email it via
//      Mailgun using the reseller's white-label brand (logo header, company
//      name, support reply-to, "Powered by CaseLift" footer) - matching the
//      other transactional emails. Falls back to returning the link if Mailgun
//      isn't configured. (Replaces the old Supabase Auth invite email, which
//      used a shared, un-brandable global SMTP template.)
//   4. Link the invited user to the new practice as a 'member'.
//
// Uses the service role for admin auth operations; the caller's own JWT is used
// only to authenticate and authorize them.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { type Brand, escapeHtml, renderBrandedEmail, resolveBrand } from "../_shared/brand.ts";
import { acceptInviteRedirectUrl } from "../_shared/invite.ts";
import { sendMailgunMessage } from "../_shared/mailgun.ts";
import { recordAuditFromReq } from "../_shared/audit.ts";
import { safeRedirect } from "../_shared/appUrl.ts";

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

// White-labeled invite email built around the reseller brand.
function buildInviteEmail(brand: Brand, practiceName: string, inviteLink: string) {
  const subject = `You've been invited to ${brand.companyName}`;
  const bodyHtml =
    `<p style="margin:0">Your ${escapeHtml(brand.companyName)} account for <strong style="color:#e2e8f0">${escapeHtml(practiceName)}</strong> is ready. ` +
    `Click below to set up your login and get started.</p>`;
  const html = renderBrandedEmail(brand, {
    heading: `You're invited to ${brand.companyName}`,
    bodyHtml,
    button: { label: "Accept Invitation", url: inviteLink },
    footerNote:
      `If the button doesn't work, paste this link into your browser:<br />` +
      `<span style="color:#64748b;word-break:break-all">${escapeHtml(inviteLink)}</span>`,
  });
  const text =
    `Your ${brand.companyName} account for ${practiceName} is ready.\n\n` +
    `Set up your account: ${inviteLink}`;
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
    const agencyId: string | undefined = body.agency_id;
    const practiceName: string | undefined = body.practice_name;
    const email: string | undefined = body.email;
    const doctorFirst: string | null = body.doctor_first ?? null;
    const doctorLast: string | null = body.doctor_last ?? null;
    // Force the canonical production origin; keep only the path (/accept-invite)
    // from the caller so a localhost inviter can't break the real invite link.
    const redirectTo: string = safeRedirect(body.redirect_to, "/accept-invite");

    if (!agencyId || !practiceName || !email) {
      return json({ error: "agency_id, practice_name, and email are required" }, 400);
    }

    // Service-role client for admin + privileged writes.
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // --- 1) Authorize: caller must be owner/admin of this agency. ---
    const { data: membership } = await admin
      .from("agency_members")
      .select("role")
      .eq("agency_id", agencyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return json({ error: "You are not an admin of this reseller" }, 403);
    }

    // --- 2) Create the practice under the agency. ---
    const { data: practice, error: practiceErr } = await admin
      .from("practices")
      .insert({
        name: practiceName,
        doctor_first: doctorFirst,
        doctor_last: doctorLast,
        email,
        agency_id: agencyId,
      })
      .select("id")
      .single();
    if (practiceErr) throw practiceErr;
    const practiceId = practice.id;

    await recordAuditFromReq(admin, req, {
      action: "practice.created",
      userId: user.id,
      userEmail: user.email ?? null,
      practiceId,
      resourceType: "practice",
      resourceId: practiceId,
      details: { agency_id: agencyId, name: practiceName, via: "agency_invite" },
    });

    // --- 3) Generate a shareable link, then email it via Mailgun using the
    //         reseller's white-label brand. (No longer uses Supabase Auth's
    //         un-brandable invite email.) Prefer an "invite" link; if the email
    //         is already a registered user (invite fails for existing accounts),
    //         fall back to a magic-link so the agency still gets a usable link. ---
    async function makeLink(type: "invite" | "magiclink") {
      const { data, error } = await admin.auth.admin.generateLink({ type, email, options: { redirectTo } });
      if (error) console.warn(`invite-practice-user: generateLink(${type}) failed:`, error.message);
      return error || !data?.properties?.action_link ? null : data;
    }
    // deno-lint-ignore no-explicit-any
    const linkData: any = (await makeLink("invite")) ?? (await makeLink("magiclink"));
    if (!linkData) {
      // The practice was created; surface a partial success so the agency can retry.
      return json(
        {
          practice_id: practiceId,
          email_sent: false,
          invite_link: null,
          warning: "Practice created, but an invite link could not be generated. Open the practice from the list and resend the invite.",
        },
        207,
      );
    }
    const invitedUserId: string | null = linkData.user?.id ?? null;
    const inviteLink: string = linkData.properties.action_link;

    // Resolve the reseller brand for this practice and send the branded invite.
    const brand = await resolveBrand(admin, { agency_id: agencyId });
    const { subject, html, text } = buildInviteEmail(brand, practiceName, inviteLink);
    const sendResult = await sendMailgunMessage({
      to: email,
      subject,
      text,
      html,
      fromName: brand.fromName,
      replyTo: brand.supportEmail,
    });

    // --- 4) Link the invited user to the practice as a member. ---
    if (invitedUserId) {
      // The on_auth_user_created trigger inserts the public.users row; ensure it
      // points at the new practice with a member role.
      await admin
        .from("users")
        .upsert(
          { id: invitedUserId, email, practice_id: practiceId, role: "member" },
          { onConflict: "id" },
        );
      // Record the membership so the practice switcher (multi-location) lists it.
      await admin
        .from("practice_members")
        .upsert(
          { practice_id: practiceId, user_id: invitedUserId, role: "member" },
          { onConflict: "practice_id,user_id", ignoreDuplicates: true },
        );
    }

    await recordAuditFromReq(admin, req, {
      action: "user.invited",
      userId: user.id,
      userEmail: user.email ?? null,
      practiceId,
      resourceType: "user",
      resourceId: email,
      details: { role: "member", via: "agency_invite", invited_user_id: invitedUserId },
    });

    return json({
      practice_id: practiceId,
      invited_user_id: invitedUserId,
      email_sent: sendResult.sent === true,
      // When Mailgun isn't configured, hand back the link so the agency can share it.
      invite_link: sendResult.sent === true ? null : inviteLink,
    });
  } catch (e) {
    await reportEdgeError("invite-practice-user", e);
    console.error("invite-practice-user error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
