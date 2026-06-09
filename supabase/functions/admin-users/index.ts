import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// admin-users - super-admin user management across all subaccounts/resellers.
//
// Gated to super-admins only. Uses the service-role client for all writes
// (creating auth users + setting access_level can't be done from the client).
//
// Actions (POST body.action):
//   invite     { email, access, agency_id?, practice_id?, role?, app_origin? }
//              → create/find the auth user, set their access, email an invite link
//   set_access { user_id, access, agency_id?, practice_id?, role? }
//              → change an existing user's access level / scope
//   remove     { user_id, mode? = 'revoke' | 'delete' }
//              → revoke all access (default) or hard-delete the auth account
//
//   access ∈ 'super_admin' | 'reseller' | 'practice'
//   role:  reseller → 'owner' | 'admin';  practice → 'owner' | 'member' | 'viewer'
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//          MAILGUN_*, APP_URL.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { renderBrandedEmail, resolveBrand } from "../_shared/brand.ts";
import { sendMailgunMessage } from "../_shared/mailgun.ts";
import { recordAuditFromReq } from "../_shared/audit.ts";

const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Map the chosen access + role onto our users.access_level + users.role columns.
function resolveAccess(access: string, role?: string): {
  access_level: string;
  userRole: string;
  practiceScoped: boolean;
  agencyScoped: boolean;
} {
  if (access === "super_admin") {
    return { access_level: "super_admin", userRole: "admin", practiceScoped: false, agencyScoped: false };
  }
  if (access === "reseller") {
    const r = role === "admin" ? "admin" : "owner";
    return { access_level: `agency_${r}`, userRole: "member", practiceScoped: false, agencyScoped: true };
  }
  const r = ["owner", "member", "viewer"].includes(role || "") ? (role as string) : "member";
  return { access_level: `practice_${r}`, userRole: r, practiceScoped: true, agencyScoped: false };
}

const accessLabel = (access: string, role?: string) =>
  access === "super_admin"
    ? "Super Admin"
    : access === "reseller"
    ? `Reseller ${role === "admin" ? "admin" : "owner"}`
    : `practice ${["owner", "member", "viewer"].includes(role || "") ? role : "member"}`;

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

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // --- Gate: caller must be a super-admin (by access_level or the SA email). ---
    const { data: me } = await admin.from("users").select("access_level").eq("id", user.id).maybeSingle();
    const isSuper = me?.access_level === "super_admin" ||
      (user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
    if (!isSuper) return json({ error: "Super-admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action;

    // ---- invite a new (or existing) user with a chosen access level ----
    if (action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const access = String(body.access || "practice");
      const role = body.role as string | undefined;
      const agencyId = body.agency_id as string | undefined;
      const practiceId = body.practice_id as string | undefined;
      if (!email) return json({ error: "email is required" }, 400);
      if (access === "reseller" && !agencyId) return json({ error: "Select a reseller for reseller access" }, 400);
      if (access === "practice" && !practiceId) return json({ error: "Select a subaccount for practice access" }, 400);

      const { access_level, userRole, practiceScoped, agencyScoped } = resolveAccess(access, role);
      const appOrigin = String(body.app_origin || Deno.env.get("APP_URL") || "https://app.caselift.io").replace(/\/$/, "");

      // If this email already belongs to a user (e.g. a previously deactivated
      // one), lift any ban FIRST so we can generate a sign-in link and reactivate
      // them. Their access is (re)granted by the upsert below.
      const { data: priorRow } = await admin.from("users").select("id").eq("email", email).maybeSingle();
      if (priorRow?.id) {
        await admin.auth.admin.updateUserById(priorRow.id, { ban_duration: "none" });
      }

      // Create the auth user (invite); if they already exist, fall back to a
      // magic link so we still get their id and can email them in.
      const makeLink = async (type: "invite" | "magiclink") => {
        const { data, error } = await admin.auth.admin.generateLink({ type, email, options: { redirectTo: appOrigin } });
        if (error) return null;
        return data;
      };
      const linkData = (await makeLink("invite")) ?? (await makeLink("magiclink"));
      const newUserId = linkData?.user?.id;
      if (!newUserId) return json({ error: "Could not create or locate that user." }, 502);

      await admin.from("users").upsert(
        { id: newUserId, email, access_level, role: userRole, practice_id: practiceScoped ? practiceId : null },
        { onConflict: "id" },
      );
      if (agencyScoped) {
        await admin.from("agency_members").upsert(
          { user_id: newUserId, agency_id: agencyId, role: role === "admin" ? "admin" : "owner" },
          { onConflict: "user_id,agency_id" },
        );
      }

      const inviteLink = linkData?.properties?.action_link as string | undefined;
      const brand = await resolveBrand(admin, null);
      const html = renderBrandedEmail(brand, {
        heading: `You've been granted ${accessLabel(access, role)} access`,
        bodyHtml: `<p style="margin:0">You've been given <strong>${accessLabel(access, role)}</strong> access to ${brand.companyName}. Click below to set up your account and sign in.</p>`,
        button: { label: "Set up your account", url: inviteLink || appOrigin },
        footerNote: "If you weren't expecting this, you can ignore this email.",
      });
      const text = `You've been granted ${accessLabel(access, role)} access to ${brand.companyName}.\n\nSet up your account: ${inviteLink || appOrigin}`;
      let emailSent = false;
      if (inviteLink) {
        const r = await sendMailgunMessage({
          to: email,
          subject: `Your ${brand.companyName} access`,
          text,
          html,
          fromName: brand.fromName,
          replyTo: brand.supportEmail,
        });
        emailSent = r.sent === true;
      }
      await recordAuditFromReq(admin, req, {
        action: "user.invited",
        userId: user.id,
        userEmail: user.email ?? null,
        practiceId: practiceScoped ? (practiceId ?? null) : null,
        resourceType: "user",
        resourceId: email,
        details: { access, role: role ?? null, access_level, agency_id: agencyId ?? null },
      });
      return json({ ok: true, user_id: newUserId, email_sent: emailSent, invite_link: inviteLink ?? null });
    }

    // ---- change an existing user's access ----
    if (action === "set_access") {
      const userId = String(body.user_id || "");
      const access = String(body.access || "practice");
      const role = body.role as string | undefined;
      const agencyId = body.agency_id as string | undefined;
      const practiceId = body.practice_id as string | undefined;
      if (!userId) return json({ error: "user_id is required" }, 400);
      if (access === "reseller" && !agencyId) return json({ error: "Select a reseller for reseller access" }, 400);
      if (access === "practice" && !practiceId) return json({ error: "Select a subaccount for practice access" }, 400);

      const { access_level, userRole, practiceScoped, agencyScoped } = resolveAccess(access, role);
      await admin.from("users").update({
        access_level,
        role: userRole,
        practice_id: practiceScoped ? practiceId : null,
      }).eq("id", userId);
      // Granting access also lifts any deactivation ban so they can sign in again.
      await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });

      if (agencyScoped) {
        // Reset memberships then set the single chosen one.
        await admin.from("agency_members").delete().eq("user_id", userId).neq("agency_id", agencyId);
        await admin.from("agency_members").upsert(
          { user_id: userId, agency_id: agencyId, role: role === "admin" ? "admin" : "owner" },
          { onConflict: "user_id,agency_id" },
        );
      } else {
        await admin.from("agency_members").delete().eq("user_id", userId);
      }
      await recordAuditFromReq(admin, req, {
        action: "user.role_changed",
        userId: user.id,
        userEmail: user.email ?? null,
        practiceId: practiceScoped ? (practiceId ?? null) : null,
        resourceType: "user",
        resourceId: userId,
        details: { access, role: role ?? null, access_level, agency_id: agencyId ?? null },
      });
      return json({ ok: true });
    }

    // ---- remove: deactivate (keep account + ban login), revoke (legacy), or hard-delete ----
    if (action === "remove") {
      const userId = String(body.user_id || "");
      const mode = body.mode === "delete"
        ? "delete"
        : body.mode === "deactivate"
        ? "deactivate"
        : "revoke";
      if (!userId) return json({ error: "user_id is required" }, 400);
      if (userId === user.id) return json({ error: "You can't remove your own account." }, 400);

      await admin.from("agency_members").delete().eq("user_id", userId);
      if (mode === "delete") {
        // Cascades the public.users row via the FK on delete cascade.
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) return json({ error: error.message }, 502);
      } else if (mode === "deactivate") {
        // Keep the account + users row as a record of who once had access, strip
        // their access, and BAN the auth user so they can't sign in until they're
        // re-invited (which un-bans + re-grants). The email stays reserved to them.
        await admin.from("users").update({ access_level: "deactivated", practice_id: null, role: "member" }).eq("id", userId);
        const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876600h" });
        if (error) return json({ error: error.message }, 502);
      } else {
        await admin.from("users").update({ access_level: null, practice_id: null, role: "member" }).eq("id", userId);
      }
      await recordAuditFromReq(admin, req, {
        action: mode === "deactivate" ? "user.deactivated" : "user.role_changed",
        userId: user.id,
        userEmail: user.email ?? null,
        resourceType: "user",
        resourceId: userId,
        details: { mode },
      });
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    await reportEdgeError("admin-users", e);
    console.error("admin-users error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
