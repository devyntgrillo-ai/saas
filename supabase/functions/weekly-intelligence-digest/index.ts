import { reportEdgeError } from "../_shared/report-error.ts";
// weekly-intelligence-digest - Monday intelligence email to each practice owner via Mailgun.
// Runs for all practices (cron) or a single practice (body.practice_id, manual).
// Service-role; verify_jwt=false (internal job). No-ops cleanly if Mailgun is unset.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { requireServiceRole } from "../_shared/auth.ts";
import { type Brand, escapeHtml, renderBrandedEmail, resolveBrand, statTiles, winBox } from "../_shared/brand.ts";
import { isMailgunConfigured, sendMailgunMessage } from "../_shared/mailgun.ts";
import { resolveDigestEmails } from "../_shared/recipients.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const money = (n: number) => "$" + (Number(n) || 0).toLocaleString();
const pct = (n: number) => Math.round((Number(n) || 0) * 100) + "%";
const weekAgoISO = () => new Date(Date.now() - 7 * 86400000).toISOString();

function buildHtml(p: { name?: string }, d: Record<string, unknown>, brand: Brand) {
  const insight = d.insight as { finding?: string; recommendation?: string } | null;
  const recovered = Number(d.recoveredValue) || 0;
  const recoveredCount = Number(d.recoveredCount) || 0;
  const tiles: Array<{ label: string; value: string; accent?: string }> = [
    { label: "Consults Recorded", value: String(d.consults ?? 0) },
    { label: "Follow-ups Sent", value: String(d.sequences ?? 0) },
    { label: "Patients Re-engaged", value: String(d.replies ?? 0) },
  ];
  // Only show a money stat when there's an actual win - never a $0 row.
  if (recovered > 0) tiles.push({ label: "Production Recovered", value: money(recovered), accent: "#34d399" });
  const rows = statTiles(tiles);
  const win = recovered > 0
    ? winBox(`💰 <strong style="color:#fff">${money(recovered)}</strong> recovered across ${recoveredCount} case${recoveredCount === 1 ? "" : "s"} this week.`)
    : "";
  const insightBlock = insight
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td style="background:#0f1117;border:1px solid #2a3142;border-radius:8px;padding:16px">
         <p style="color:${brand.primaryColor};font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Insight for your patient mix</p>
         <p style="color:#e2e8f0;font-size:14px;line-height:1.6;margin:0 0 6px">${escapeHtml(insight.finding || "")}</p>
         <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0"><strong style="color:#cbd5e1">Try this:</strong> ${escapeHtml(insight.recommendation || "")}</p>
       </td></tr></table>`
    : "";
  return renderBrandedEmail(brand, {
    heading: `Here's what ${brand.companyName} did for you this week.`,
    bodyHtml: `<p style="margin:0">${escapeHtml(p.name || "Your practice")}</p>${rows}${win}${insightBlock}`,
    button: { label: "View Full Dashboard", url: "https://app.caselift.io" },
    footerNote: "Manage weekly reports in Settings &rarr; Notifications.",
  });
}

// deno-lint-ignore no-explicit-any
async function digestFor(supabase: any, practice: { id: string }) {
  const since = weekAgoISO();
  const [{ count: consults }, outcomesRes] = await Promise.all([
    supabase.from("consults").select("id", { count: "exact", head: true }).eq("practice_id", practice.id).gte("created_at", since),
    supabase.from("message_outcomes").select("consult_id, message_position, replied, replied_at, sent_at, closed_after, closed_at, treatment_value").eq("practice_id", practice.id),
  ]);
  const outcomes = outcomesRes.data || [];
  const weekOut = outcomes.filter((o: { sent_at?: string }) => o.sent_at && o.sent_at >= since);
  const sequences = new Set(weekOut.map((o: { consult_id: string }) => o.consult_id)).size;
  const replies = outcomes.filter((o: { replied_at?: string }) => o.replied_at && o.replied_at >= since).length;

  const pos: Record<string, { n: number; r: number }> = {};
  for (const o of outcomes) {
    const k = o.message_position;
    if (!k) continue;
    pos[k] = pos[k] || { n: 0, r: 0 };
    pos[k].n++;
    if (o.replied) pos[k].r++;
  }
  const best = Object.entries(pos).map(([k, v]) => ({ k, rate: v.r / v.n, n: v.n })).sort((a, b) => b.rate - a.rate)[0];
  const bestMessage = best ? `Message ${best.k} - ${pct(best.rate)} reply rate (${best.n} sent)` : "Not enough data yet";

  const recovered = new Map<string, number>();
  for (const o of outcomes) {
    if (o.closed_after && o.closed_at && o.closed_at >= since) recovered.set(o.consult_id, Number(o.treatment_value) || 0);
  }
  const recoveredValue = [...recovered.values()].reduce((a, b) => a + b, 0);

  const { data: topObj } = await supabase.from("consults").select("objection_type").eq("practice_id", practice.id).not("objection_type", "is", null).limit(200);
  const objCount: Record<string, number> = {};
  for (const c of topObj || []) objCount[c.objection_type] = (objCount[c.objection_type] || 0) + 1;
  const commonObj = Object.entries(objCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  let insight = null;
  if (commonObj) {
    const { data: ni } = await supabase.from("network_insights").select("finding, recommendation").eq("objection_type", commonObj).order("confidence_score", { ascending: false }).limit(1);
    insight = ni?.[0] || null;
  }
  return { consults: consults || 0, sequences, replies, bestMessage, recoveredCount: recovered.size, recoveredValue, insight };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const authErr = requireServiceRole(req);
  if (authErr) return authErr;
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const body = await req.json().catch(() => ({}));

    let q = supabase.from("practices").select("id, name, email, agency_id").not("email", "is", null);
    if (body.practice_id) q = q.eq("id", body.practice_id);
    const { data: practices, error } = await q;
    if (error) return json({ error: error.message }, 400);

    const configured = isMailgunConfigured();
    const results: unknown[] = [];
    for (const p of practices || []) {
      const d = await digestFor(supabase, p);
      // Don't send a flat/empty week. Manual single-practice runs always send.
      const hasActivity = (Number(d.consults) || 0) > 0 || (Number(d.sequences) || 0) > 0 ||
        (Number(d.replies) || 0) > 0 || (Number(d.recoveredValue) || 0) > 0;
      if (!body.practice_id && !hasActivity) {
        results.push({ practice: p.id, skipped: "no_activity_this_week" });
        continue;
      }
      const brand = await resolveBrand(supabase, p);
      const html = buildHtml(p, d, brand);
      const subject = `Your ${brand.companyName} Weekly Report, ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
      const text =
        `Here's what ${brand.companyName} did for you this week.\n\n` +
        `Consults Recorded: ${d.consults}\n` +
        `Follow-ups Sent: ${d.sequences}\n` +
        `Patients Re-engaged: ${d.replies}\n` +
        `Estimated Production Recovered: ${money(d.recoveredValue)}\n\n` +
        `View your full dashboard: https://app.caselift.io`;

      if (!configured) {
        results.push({ practice: p.id, sent: false, reason: "mailgun_not_configured", preview: d });
        continue;
      }
      // Per-user: members who enabled the weekly digest get it at their own
      // address; fall back to the practice contact when nobody has opted in.
      const digestEmails = await resolveDigestEmails(admin, p.id);
      const recipients = digestEmails.length ? digestEmails : (p.email ? [p.email] : []);
      if (!recipients.length) {
        results.push({ practice: p.id, sent: false, reason: "No email on file" });
        continue;
      }
      const sends = await Promise.all(
        recipients.map((to: string) =>
          sendMailgunMessage({ to, subject, text, html, fromName: brand.fromName, replyTo: brand.supportEmail, fromKind: "digest" }),
        ),
      );
      const anySent = sends.some((s) => s.sent);
      results.push({ practice: p.id, sent: anySent, recipients: recipients.length });
    }
    return json({ ok: true, configured, count: results.length, results });
  } catch (e) {
    await reportEdgeError("weekly-intelligence-digest", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
