// weekly-intelligence-digest - Monday intelligence email to each practice owner via Mailgun.
// Runs for all practices (cron) or a single practice (body.practice_id, manual).
// Service-role; verify_jwt=false (internal job). No-ops cleanly if Mailgun is unset.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { resolveBrand } from "../_shared/brand.ts";
import { isMailgunConfigured, sendMailgunMessage } from "../_shared/mailgun.ts";

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

function buildHtml(p: { name?: string }, d: Record<string, unknown>, brandName: string, primaryColor: string) {
  const insight = d.insight as { finding?: string; recommendation?: string } | null;
  return `<!doctype html><html><body style="margin:0;background:#0b0f17;font-family:Inter,Arial,sans-serif;color:#cbd5e1">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h1 style="color:#fff;font-size:18px;margin:0 0 4px">${brandName} Weekly</h1>
    <p style="color:#64748b;font-size:13px;margin:0 0 20px">Your practice intelligence update for ${p.name || "your practice"}</p>
    <div style="background:#0f1521;border:1px solid #1e2738;border-radius:12px;padding:16px;margin-bottom:14px">
      <p style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">This week</p>
      <p style="margin:0;font-size:14px;line-height:1.7">${d.consults} consults analyzed &middot; ${d.sequences} sequences started &middot; <b style="color:#fff">${d.replies} replies</b> received</p>
    </div>
    <div style="background:#0f1521;border:1px solid #1e2738;border-radius:12px;padding:16px;margin-bottom:14px">
      <p style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Your best performing message</p>
      <p style="margin:0;font-size:14px">${d.bestMessage}</p>
    </div>
    ${insight ? `<div style="background:#0f1521;border:1px solid #2563eb33;border-radius:12px;padding:16px;margin-bottom:14px">
      <p style="color:#60a5fa;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Network insight for your patient mix</p>
      <p style="margin:0 0 6px;font-size:14px;color:#fff">${insight.finding}</p>
      <p style="margin:0;font-size:13px;color:#94a3b8"><b style="color:#cbd5e1">Try this:</b> ${insight.recommendation}</p>
    </div>` : ""}
    <div style="background:#0f1521;border:1px solid #34d39933;border-radius:12px;padding:16px;margin-bottom:14px">
      <p style="color:#34d399;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Cases recovered this week</p>
      <p style="margin:0;font-size:14px">${d.recoveredCount} case(s) &middot; <b style="color:#fff">${money(d.recoveredValue as number)}</b> in production</p>
    </div>
    <a href="https://app.heyhope.ai/" style="display:inline-block;background:${primaryColor};color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:8px">View your dashboard</a>
    <p style="color:#475569;font-size:11px;margin-top:20px">You are receiving this because you own a ${brandName} practice.</p>
  </div></body></html>`;
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
      const brand = await resolveBrand(supabase, p);
      const html = buildHtml(p, d, brand.companyName, brand.primaryColor);
      const subject = `${brand.companyName} Weekly - Your practice intelligence update`;
      const text =
        `This week: ${d.consults} consults, ${d.sequences} sequences, ${d.replies} replies.\n` +
        `Best message: ${d.bestMessage}\n` +
        `Recovered: ${d.recoveredCount} cases (${money(d.recoveredValue)}).\n` +
        `https://app.heyhope.ai/`;

      if (!configured) {
        results.push({ practice: p.id, sent: false, reason: "mailgun_not_configured", preview: d });
        continue;
      }
      if (!p.email) {
        results.push({ practice: p.id, sent: false, reason: "No email on file" });
        continue;
      }
      const send = await sendMailgunMessage({
        to: p.email,
        subject,
        text,
        html,
        fromName: brand.fromName,
        replyTo: brand.supportEmail,
        fromKind: "digest",
      });
      results.push({ practice: p.id, sent: send.sent, reason: send.sent ? undefined : (send as { reason: string }).reason });
    }
    return json({ ok: true, configured, count: results.length, results });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
