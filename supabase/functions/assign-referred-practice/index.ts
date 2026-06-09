import { reportEdgeError } from "../_shared/report-error.ts";
// assign-referred-practice — super-admin provisioning. Attaches a practice to a
// referring agency by setting practices.agency_id (which is BOTH the commission
// attribution AND the white-label co-brand inheritance — one action), then sends
// ONE Mailgun commission-notification email to the agency owner.
//
// The dollar amount in the email reads from agency_accounts.commission_rate —
// the same field the admin Commissions payout tally reads — so the email and the
// actual payout can never drift apart.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { sendMailgunMessage } from "../_shared/mailgun.ts";
import { escapeHtml } from "../_shared/brand.ts";

const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";
const COMMISSION_DEFAULT = 200;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

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

    // Gate: super-admin only (by access_level or the SA email).
    const { data: me } = await admin.from("users").select("access_level").eq("id", user.id).maybeSingle();
    const isSuper = me?.access_level === "super_admin" || (user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
    if (!isSuper) return json({ error: "Super-admin access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const practiceId = String(body.practice_id || "");
    const agencyId = String(body.agency_id || "");
    if (!practiceId || !agencyId) return json({ error: "practice_id and agency_id are required" }, 400);

    const { data: agency } = await admin
      .from("agency_accounts")
      .select("id, name, owner_email, commission_rate")
      .eq("id", agencyId)
      .maybeSingle();
    if (!agency) return json({ error: "Agency not found" }, 404);

    const { data: practice } = await admin
      .from("practices")
      .select("id, name, agency_id")
      .eq("id", practiceId)
      .maybeSingle();
    if (!practice) return json({ error: "Practice not found" }, 404);

    // Provision: one action sets attribution + co-brand inheritance.
    const { error: upErr } = await admin.from("practices").update({ agency_id: agencyId }).eq("id", practiceId);
    if (upErr) throw upErr;

    // Notify the agency — amount straight from commission_rate.
    const r = Number(agency.commission_rate);
    const amount = Number.isFinite(r) && r >= 0 ? r : COMMISSION_DEFAULT;
    const practiceName = practice.name || "A new practice";
    let emailed = false;
    if (agency.owner_email) {
      const line = `${practiceName} just signed up. That's +${money(amount)}/mo added to your CaseLift payouts.`;
      const text = `${line}\n\nYou'll see it on your next monthly commission payout.\n\n— CaseLift`;
      const html =
        `<p style="font-size:16px;line-height:1.6;color:#0f172a;margin:0 0 14px">` +
        `<strong>${escapeHtml(practiceName)}</strong> just signed up. That's ` +
        `<strong>+${money(amount)}/mo</strong> added to your CaseLift payouts.</p>` +
        `<p style="font-size:14px;line-height:1.6;color:#475569;margin:0">You'll see it on your next monthly commission payout.</p>`;
      const sent = await sendMailgunMessage({
        to: agency.owner_email,
        subject: `New referral: ${practiceName} just signed up`,
        text,
        html,
        fromName: "CaseLift",
      });
      emailed = sent.sent === true;
    }

    return json({ ok: true, emailed, amount });
  } catch (e) {
    await reportEdgeError("assign-referred-practice", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
