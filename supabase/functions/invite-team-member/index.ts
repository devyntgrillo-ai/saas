// ============================================================================
// invite-team-member - email a team invite for an existing practice (TC onboarding,
// practice/agency InviteModal). Creates an invitations row when needed, then sends
// a branded Mailgun email with the /invite/:token link.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { type Brand, emailFooter, emailHeader, emailSignature, resolveBrand } from "../_shared/brand.ts";
import { sendMailgunMessage } from "../_shared/mailgun.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTeamInviteEmail(brand: Brand, scopeName: string, inviteLink: string, personalMessage?: string | null) {
  const subject = `You're invited to ${scopeName} on ${brand.companyName}`;
  const note = personalMessage
    ? `<p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px;font-style:italic">"${escapeHtml(personalMessage)}"</p>`
    : "";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">
      <div style="margin-bottom:20px">${emailHeader(brand)}</div>
      <h1 style="font-size:20px;margin:0 0 12px">Join ${escapeHtml(scopeName)}</h1>
      ${note}
      <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 20px">
        You've been invited to collaborate on patient follow-up and consult recovery with Hope AI.
      </p>
      <a href="${inviteLink}" style="display:inline-block;background:${brand.primaryColor};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">Accept invitation</a>
      <p style="font-size:12px;color:#6b7280;margin:20px 0 0;word-break:break-all">${inviteLink}</p>
      ${emailSignature(brand)}
      ${emailFooter(brand)}
    </div>`;
  const text =
    `You're invited to join ${scopeName} on ${brand.companyName}.\n\nAccept: ${inviteLink}\n\n${personalMessage ? `${personalMessage}\n\n` : ""}Questions? ${brand.supportEmail}`;
  return { subject, html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const practiceId: string | undefined = body.practice_id;
    const email = String(body.email || "").trim().toLowerCase();
    const invitationToken: string | undefined = body.invitation_token;
    const role = body.role || "member";
    const accessLevel = body.access_level || "practice_member";
    const personalMessage = body.personal_message ?? null;
    const appOrigin = String(body.app_origin || Deno.env.get("APP_URL") || "https://app.heyhope.ai").replace(/\/$/, "");

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let token = invitationToken;
    let practiceName = "";
    let practiceRow: { id: string; name: string; agency_id?: string | null } | null = null;

    let recipientEmail = email;

    if (token) {
      const { data: inv } = await admin
        .from("invitations")
        .select("*, practice:practices(id, name, agency_id), agency:agency_accounts(id, name)")
        .eq("token", token)
        .maybeSingle();
      if (!inv) return json({ error: "Invitation not found" }, 404);
      recipientEmail = inv.email;
      practiceRow = inv.practice as { id: string; name: string; agency_id?: string | null } | null;
      if (!practiceRow?.id && inv.agency_id) {
        const ag = inv.agency as { id: string; name: string } | null;
        practiceRow = { id: inv.agency_id, name: ag?.name || "your team", agency_id: inv.agency_id };
      }
      if (!practiceRow?.id) return json({ error: "Invitation has no practice or agency" }, 400);
    } else {
      if (!practiceId || !email) return json({ error: "practice_id and email are required" }, 400);
      const { data: pr } = await admin.from("practices").select("id, name, agency_id").eq("id", practiceId).maybeSingle();
      if (!pr) return json({ error: "Practice not found" }, 404);
      practiceRow = pr;

      const { data: caller } = await admin.from("users").select("practice_id, access_level, role").eq("id", user.id).maybeSingle();
      const canInvite =
        caller?.practice_id === practiceId &&
        (caller?.role === "owner" || caller?.access_level === "practice_owner" || caller?.access_level === "super_admin");
      if (!canInvite) {
        const { data: mem } = await admin.from("agency_members").select("role, agency_id")
          .eq("user_id", user.id).maybeSingle();
        const agencyOk = mem && pr.agency_id && mem.agency_id === pr.agency_id && ["owner", "admin"].includes(mem.role);
        if (!agencyOk && caller?.access_level !== "super_admin") {
          return json({ error: "You cannot invite users to this practice" }, 403);
        }
      }

      const { data: created, error: invErr } = await admin.from("invitations").insert({
        email,
        role,
        access_level: accessLevel,
        practice_id: practiceId,
        personal_message: personalMessage,
        invited_by_user_id: user.id,
      }).select("token").single();
      if (invErr) throw invErr;
      token = created.token;
    }

    const scopeName = practiceRow?.name || "your practice";
    const inviteLink = `${appOrigin}/invite/${token}`;
    const brand = await resolveBrand(admin, practiceRow);
    const { subject, html, text } = buildTeamInviteEmail(brand, scopeName, inviteLink, personalMessage);
    if (!recipientEmail) return json({ error: "No recipient email" }, 400);

    const sendResult = await sendMailgunMessage({
      to: recipientEmail,
      subject,
      text,
      html,
      fromName: brand.fromName,
      replyTo: brand.supportEmail,
    });

    return json({
      ok: true,
      email_sent: sendResult.sent === true,
      invite_link: sendResult.sent ? null : inviteLink,
      reason: sendResult.sent ? undefined : (sendResult as { reason: string }).reason,
      detail: (sendResult as { detail?: string }).detail,
    });
  } catch (e) {
    console.error("invite-team-member error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
