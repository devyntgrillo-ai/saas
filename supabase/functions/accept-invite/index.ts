// accept-invite — completes an invitation from its token ALONE, with no reliance
// on a Supabase one-time magic-link session. This is the scanner/expiry-proof
// path: corporate email security pre-fetches links (consuming Supabase's
// single-use verify token), but a token in a query param is not consumed by a
// GET — only by this POST — so the human can always finish.
//
// Sets the password server-side (works whether the auth user already exists or
// not), grants the invitation's access, and marks it accepted. verify_jwt=false:
// authorization IS the unguessable invitation token.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { recordAuditFromReq } from "../_shared/audit.ts";
import { reportEdgeError } from "../_shared/report-error.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Map an invitation's role string onto the users.role vocabulary.
function mapRole(role?: string | null): string {
  const r = (role || "").toLowerCase();
  if (["practice_owner", "owner", "admin"].includes(r)) return "owner";
  if (["practice_viewer", "viewer"].includes(r)) return "viewer";
  return "member";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const token = String(body.token || "");
    const password = String(body.password || "");
    const fullName = body.full_name ? String(body.full_name) : null;
    if (!token) return json({ error: "Missing invitation token" }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters." }, 400);

    const { data: inv } = await admin.from("invitations").select("*").eq("token", token).maybeSingle();
    if (!inv) return json({ error: "This invitation is invalid." }, 404);
    if (inv.accepted_at) return json({ error: "This invitation has already been used." }, 410);
    if (new Date(inv.expires_at as string) < new Date()) {
      return json({ error: "This invitation has expired. Ask your admin to resend it." }, 410);
    }

    const email = String(inv.email).toLowerCase();

    // Resolve the auth user: an existing account (the on_auth_user_created trigger
    // mirrors auth users into public.users) gets its password reset + un-banned;
    // a brand-new invitee is created with the password they just chose.
    const { data: existing } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    let userId = existing?.id as string | undefined;
    if (userId) {
      const { error: upErr } = await admin.auth.admin.updateUserById(userId, {
        password,
        ban_duration: "none",
        email_confirm: true,
      });
      if (upErr) throw upErr;
    } else {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      });
      if (cErr || !created?.user) throw cErr || new Error("Could not create your account.");
      userId = created.user.id;
    }

    // Grant the invitation's access (idempotent).
    const role = mapRole(inv.role as string | null);
    await admin.from("users").upsert(
      {
        id: userId,
        email,
        practice_id: (inv.practice_id as string | null) ?? null,
        role,
        access_level: (inv.access_level as string | null) ?? null,
      },
      { onConflict: "id" },
    );
    if (inv.agency_id) {
      await admin.from("agency_members").upsert(
        {
          user_id: userId,
          agency_id: inv.agency_id,
          role: inv.role === "admin" ? "admin" : "owner",
          accessible_practice_ids: (inv.accessible_practice_ids as string[] | null) ?? null,
        },
        { onConflict: "user_id,agency_id" },
      );
    }
    if (inv.practice_id) {
      await admin.from("practice_members").upsert(
        { practice_id: inv.practice_id, user_id: userId, role },
        { onConflict: "practice_id,user_id", ignoreDuplicates: true },
      );
    }

    await admin.from("invitations").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id);

    await recordAuditFromReq(admin, req, {
      action: "user.invited",
      userId,
      userEmail: email,
      practiceId: (inv.practice_id as string | null) ?? null,
      resourceType: "user",
      resourceId: email,
      details: { accepted: true, via: "invitation_token" },
    });

    return json({ ok: true, email });
  } catch (e) {
    await reportEdgeError("accept-invite", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
