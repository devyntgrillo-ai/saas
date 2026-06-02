// ============================================================================
// invite-practice-user - agency onboarding of a new client practice + its TC.
//
// Flow:
//   1. Verify the caller is an owner/admin of the target agency.
//   2. Create the practice record under that agency (service role).
//   3. Generate a Supabase magic invite link server-side and email it via
//      Mailgun using the reseller's white-label brand (logo header, company
//      name, support reply-to, "Powered by Hope AI" footer) - matching the
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

// Send a branded invite via Mailgun. Keeps the existing noreply@domain address;
// only the display name + reply-to are branded (mirrors the other functions).
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
    console.warn("invite-practice-user: MAILGUN_DOMAIN/MAILGUN_API_KEY not set - skipping email send");
    return { sent: false, reason: "mailgun_not_configured" };
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
    const detail = await res.text();
    console.error(`invite-practice-user Mailgun send failed ${res.status}:`, detail);
    return { sent: false, reason: `mailgun_${res.status}` };
  }
  return { sent: true };
}

// White-labeled invite email built around the reseller brand.
function buildInviteEmail(brand: Brand, practiceName: string, inviteLink: string) {
  const subject = `Welcome to ${brand.companyName} - Meet Hope`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">
      <div style="margin-bottom:20px">${emailHeader(brand)}</div>
      <h1 style="font-size:20px;margin:0 0 12px">Welcome to ${escapeHtml(brand.companyName)} - meet Hope</h1>
      <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 20px">
        Hi - I'm Hope, your AI assistant at ${escapeHtml(practiceName)}. I listen to your consults,
        follow up with patients, and recover more implant cases for you. Click below to set up your
        account and we'll get started together.
      </p>
      <a href="${inviteLink}" style="display:inline-block;background:${brand.primaryColor};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px">
        Accept invitation
      </a>
      <p style="font-size:12px;line-height:1.6;color:#6b7280;margin:20px 0 0">
        If the button doesn't work, copy and paste this link into your browser:<br />
        <a href="${inviteLink}" style="color:${brand.primaryColor};word-break:break-all">${inviteLink}</a>
      </p>
      <p style="font-size:12px;color:#6b7280;margin:16px 0 0">
        Questions? Reach us at <a href="mailto:${brand.supportEmail}" style="color:${brand.primaryColor}">${brand.supportEmail}</a>.
      </p>
      ${emailSignature(brand)}
      ${emailFooter(brand)}
    </div>`;
  const text =
    `Welcome to ${brand.companyName} - meet Hope.\n\n` +
    `I'm Hope, your AI assistant at ${practiceName}. Set up your account to get started: ${inviteLink}\n\n` +
    `Questions? Email ${brand.supportEmail}`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    const redirectTo: string | undefined = body.redirect_to;

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
    const sendResult = await sendMailgun(email, subject, html, text, brand.fromName, brand.supportEmail);

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
    }

    return json({
      practice_id: practiceId,
      invited_user_id: invitedUserId,
      email_sent: sendResult.sent === true,
      // When Mailgun isn't configured, hand back the link so the agency can share it.
      invite_link: sendResult.sent === true ? null : inviteLink,
    });
  } catch (e) {
    console.error("invite-practice-user error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
