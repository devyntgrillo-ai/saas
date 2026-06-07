import { reportEdgeError } from "../_shared/report-error.ts";
// refer-friend - sends a friendly referral email to one friend on behalf of the
// practice (used by the "Get a Free Month" rewards page). Self-authenticates the
// caller's token and verifies they own the practice. verify_jwt=false.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { escapeHtml, renderBrandedEmail, resolveBrand } from "../_shared/brand.ts";
import { sendMailgunMessage } from "../_shared/mailgun.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || "").trim());

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const friendEmail = String(body.friend_email || "").trim();
    const friendName = String(body.friend_name || "").trim();
    const appOrigin = String(body.app_origin || "https://app.caselift.io").replace(/\/$/, "");
    if (!isEmail(friendEmail)) return json({ error: "A valid friend email is required." }, 400);

    // Resolve the caller's practice from their token (don't trust the body).
    const scoped = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await scoped.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: prof } = await admin.from("users").select("practice_id").eq("id", user.id).maybeSingle();
    const practiceId = prof?.practice_id;
    if (!practiceId) return json({ error: "No practice linked to your account." }, 403);

    const { data: practice } = await admin
      .from("practices")
      .select("id, name, referral_code, email_enabled, email_from_name, email_reply_to, mail_subdomain, mail_from_local_part, agency:agency_accounts(*)")
      .eq("id", practiceId)
      .maybeSingle();

    const link = practice?.referral_code ? `${appOrigin}/r/${practice.referral_code}` : `${appOrigin}/signup`;
    const fromPractice = practice?.name || "A colleague";
    const brand = await resolveBrand(admin, practice);

    const greeting = friendName ? `Hi ${escapeHtml(friendName)},` : "Hi there,";
    const html = renderBrandedEmail(brand, {
      heading: `${escapeHtml(fromPractice)} thought you'd love ${escapeHtml(brand.brandName)}`,
      bodyHtml:
        `<p>${greeting}</p>` +
        `<p>${escapeHtml(fromPractice)} uses ${escapeHtml(brand.brandName)} to automatically follow up with patients after consults and recover cases that would otherwise slip away. They thought your practice would benefit too.</p>` +
        `<p>Take a look:</p>`,
      button: { label: `Check out ${brand.brandName}`, url: link },
    });
    const text = `${friendName ? `Hi ${friendName},` : "Hi there,"}\n\n${fromPractice} uses ${brand.brandName} to follow up with patients after consults and recover lost cases, and thought your practice would benefit too.\n\nTake a look: ${link}`;

    const sendResult = await sendMailgunMessage({
      to: friendEmail,
      subject: `${fromPractice} recommends ${brand.brandName}`,
      text,
      html,
      fromName: brand.fromName,
      replyTo: brand.supportEmail,
    });
    if (!sendResult.sent) {
      return json({ error: "Could not send the email right now. Please try again." , detail: (sendResult as { reason?: string }).reason }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    await reportEdgeError("refer-friend", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
