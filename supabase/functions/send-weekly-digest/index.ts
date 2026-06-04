import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// send-weekly-digest - Monday 9am UTC (pg_cron). For each active practice,
// computes the week's stats, picks the top objection + a matching training
// video, renders an HTML email and sends it via Mailgun to the owner (+ TC).
// Service-role; verify_jwt=false (internal job). No-ops cleanly if Mailgun is
// not configured. Body { practice_id } runs for a single practice (manual test).
// Each email is white-labeled to the practice's reseller brand when applicable
// (see _shared/brand.ts), falling back to CaseLift branding otherwise.
//
// Secrets: MAILGUN_API_KEY, MAILGUN_DOMAIN, (optional) MAILGUN_FROM.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/auth.ts";
import { type Brand, escapeHtml, renderBrandedEmail, resolveBrand, statRows } from "../_shared/brand.ts";
import { sendMailgunToMany } from "../_shared/mailgun.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const money = (n: number) => "$" + (Number(n) || 0).toLocaleString();
const weekAgoISO = () => new Date(Date.now() - 7 * 86400000).toISOString();

// Objection -> suggested training (titles match the Training library).
const TRAINING: Record<string, { title: string; slug: string }> = {
  price: { title: "Handling the price objection", slug: "price-objection" },
  fear: { title: "Calming the fearful patient", slug: "fear-objection" },
  spouse: { title: "Winning over the decision-maker at home", slug: "spouse-objection" },
  timing: { title: "Creating urgency without pressure", slug: "timing-objection" },
  other: { title: "Following up that converts", slug: "followup-fundamentals" },
};
const OBJ_LABEL: Record<string, string> = {
  price: "Cost & Financing", fear: "Fear & Anxiety", spouse: "Spouse / Decision-maker",
  timing: "Timing", other: "Other",
};

// deno-lint-ignore no-explicit-any
function buildHtml(p: any, d: any, brand: Brand) {
  const rows = statRows([
    { label: "Consults Recorded", value: String(d.recorded) },
    { label: "Follow-ups Sent", value: String(d.sent) },
    { label: "Patients Re-engaged", value: String(d.replies) },
    { label: "Estimated Production Recovered", value: money(d.recoveredValue || 0) },
  ]);
  return renderBrandedEmail(brand, {
    heading: `Here's what ${brand.companyName} did for you this week.`,
    bodyHtml: `<p style="margin:0 0 4px">${escapeHtml(p.name || "Your practice")}</p>${rows}`,
    button: { label: "View Full Dashboard", url: "https://app.caselift.io" },
    footerNote: "Manage weekly reports in Settings &rarr; Notifications.",
  });
}

// deno-lint-ignore no-explicit-any
async function digestForPractice(admin: any, p: any) {
  const since = weekAgoISO();
  const [{ data: consults }, { count: sent }, { data: convs }, { count: totalAppts }] = await Promise.all([
    admin.from("consults").select("id, outcome, objection_type, status, created_at").eq("practice_id", p.id).gte("created_at", since),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("practice_id", p.id).eq("status", "sent").gte("created_at", since),
    admin.from("conversations").select("id, last_message_at").eq("practice_id", p.id).gte("last_message_at", since),
    admin.from("pms_appointments").select("id", { count: "exact", head: true }).eq("practice_id", p.id).gte("appointment_time", since),
  ]);
  const cs = consults || [];
  const recorded = cs.length;
  const conversions = cs.filter((c: any) => ["accepted", "closed_won"].includes(c.outcome)).length;
  const replies = (convs || []).length;
  const tally: Record<string, number> = {};
  cs.forEach((c: any) => { const k = c.objection_type || "other"; tally[k] = (tally[k] || 0) + 1; });
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || "other";
  const totApts = totalAppts || recorded || 0;
  return {
    recorded, sent: sent || 0, replies, conversions, recoveredValue: 0,
    totalAppts: totApts,
    recordPct: totApts ? Math.round((recorded / totApts) * 100) : 0,
    topObjection: top, topObjectionLabel: OBJ_LABEL[top] || "Other",
    training: TRAINING[top] || TRAINING.other,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authErr = requireServiceRole(req);
  if (authErr) return authErr;
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const body = await req.json().catch(() => ({}));

    let q = admin.from("practices").select("id, name, email, email_reply_to, subscription_status, agency_id");
    if (body.practice_id) q = q.eq("id", body.practice_id);
    const { data: practices } = await q;

    const results: unknown[] = [];
    for (const p of practices || []) {
      // Skip practices with no contact email or cancelled subscriptions (unless single-run).
      if (!body.practice_id && (p.subscription_status === "cancelled" || p.subscription_status === "canceled")) continue;
      const to = [p.email, p.email_reply_to].filter((e: string) => e && /@/.test(e));
      const d = await digestForPractice(admin, p);
      // Resolve the reseller brand for this practice (per-practice white-labeling).
      const brand = await resolveBrand(admin, p);
      let send: unknown = { sent: false, reason: "no_recipient" };
      if (to.length) {
        send = await sendMailgunToMany({
          to: to as string[],
          subject: `Your ${brand.companyName} Weekly Report — ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
          html: buildHtml(p, d, brand),
          fromName: brand.fromName,
          replyTo: brand.supportEmail,
          fromKind: "digest",
        });
      }
      results.push({ practice_id: p.id, stats: d, send });
    }
    return json({ ok: true, count: results.length, results });
  } catch (e) {
    await reportEdgeError("send-weekly-digest", e);
    console.error("send-weekly-digest error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
