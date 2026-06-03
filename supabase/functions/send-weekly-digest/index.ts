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
import { type Brand, emailFooter, emailHeader, emailSignature, resolveBrand } from "../_shared/brand.ts";

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

async function sendMailgun(to: string[], subject: string, html: string, brand: Brand) {
  const key = Deno.env.get("MAILGUN_API_KEY");
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  if (!key || !domain) return { sent: false, reason: "mailgun_not_configured" };
  // Keep the existing digest@domain address; only the display name is branded.
  const envFrom = Deno.env.get("MAILGUN_FROM");
  const address = envFrom?.match(/<([^>]+)>/)?.[1] || `digest@${domain}`;
  const from = `${brand.fromName} <${address}>`;
  const form = new FormData();
  form.append("from", from);
  to.forEach((t) => form.append("to", t));
  form.append("subject", subject);
  form.append("html", html);
  form.append("h:Reply-To", brand.supportEmail);
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`api:${key}`) },
    body: form,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    return { sent: false, reason: `mailgun_${res.status}`, detail };
  }
  return { sent: true };
}

// deno-lint-ignore no-explicit-any
function buildHtml(p: any, d: any, brand: Brand) {
  const training = d.training;
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Inter,Arial,sans-serif;color:#1f2937">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="margin-bottom:8px">${emailHeader(brand)}</div>
    <h1 style="font-size:18px;margin:0 0 2px">${brand.companyName} Weekly</h1>
    <p style="color:#6b7280;font-size:13px;margin:0 0 14px">${p.name || "Your practice"}</p>
    <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 18px">Here's what CaseLift did this week.</p>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;margin-bottom:14px">
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        <tr><td style="padding:4px 0;color:#6b7280">Consults recorded</td><td style="text-align:right;font-weight:600">${d.recorded} of ${d.totalAppts} (${d.recordPct}%)</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Follow-ups sent</td><td style="text-align:right;font-weight:600">${d.sent}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Patient replies</td><td style="text-align:right;font-weight:600">${d.replies}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Cases converted</td><td style="text-align:right;font-weight:600;color:#059669">${d.conversions}${d.recoveredValue ? " (" + money(d.recoveredValue) + ")" : ""}</td></tr>
      </table>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;margin-bottom:14px">
      <p style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Top objection this week</p>
      <p style="margin:0;font-size:15px;font-weight:600">${d.topObjectionLabel}</p>
    </div>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:18px;margin-bottom:18px">
      <p style="color:#b45309;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Suggested training</p>
      <a href="https://app.caselift.io/training?v=${training.slug}" style="font-size:15px;font-weight:600;color:#b45309;text-decoration:none">${training.title} &rarr;</a>
    </div>
    <a href="https://app.caselift.io/" style="display:inline-block;background:${brand.primaryColor};color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:8px">Open ${brand.companyName}</a>
    ${emailSignature(brand)}
    <p style="color:#9ca3af;font-size:11px;margin:18px 0 0">You are receiving this because weekly digests are on. Manage in Settings &rarr; Notifications.</p>
    ${emailFooter(brand)}
  </div></body></html>`;
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
        send = await sendMailgun(
          to as string[],
          `${brand.companyName} Weekly - ${p.name || "your practice"}`,
          buildHtml(p, d, brand),
          brand,
        );
      }
      results.push({ practice_id: p.id, stats: d, send });
    }
    return json({ ok: true, count: results.length, results });
  } catch (e) {
    console.error("send-weekly-digest error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
