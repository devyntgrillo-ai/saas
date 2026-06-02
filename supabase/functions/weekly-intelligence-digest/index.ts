// weekly-intelligence-digest - Monday email to each practice owner via Resend.
// Runs for all practices (cron) or a single practice (body.practice_id, manual).
// Service-role; verify_jwt=false (internal job). No-ops cleanly if RESEND_API_KEY
// is unset. Scheduled via pg_cron (see supabase/schema.sql / migrations).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const money = (n) => '$' + (Number(n) || 0).toLocaleString()
const pct = (n) => Math.round((Number(n) || 0) * 100) + '%'
const weekAgoISO = () => new Date(Date.now() - 7 * 86400000).toISOString()

function buildHtml(p, d) {
  const insight = d.insight
  return `<!doctype html><html><body style="margin:0;background:#0b0f17;font-family:Inter,Arial,sans-serif;color:#cbd5e1">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h1 style="color:#fff;font-size:18px;margin:0 0 4px">Hope AI Weekly</h1>
    <p style="color:#64748b;font-size:13px;margin:0 0 20px">Your practice intelligence update for ${p.name || 'your practice'}</p>
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
    </div>` : ''}
    <div style="background:#0f1521;border:1px solid #34d39933;border-radius:12px;padding:16px;margin-bottom:14px">
      <p style="color:#34d399;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Cases recovered this week</p>
      <p style="margin:0;font-size:14px">${d.recoveredCount} case(s) &middot; <b style="color:#fff">${money(d.recoveredValue)}</b> in production</p>
    </div>
    <a href="https://app.heyhope.ai/performance" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:8px">View your dashboard</a>
    <p style="color:#475569;font-size:11px;margin-top:20px">You are receiving this because you own a Hope AI practice.</p>
  </div></body></html>`
}

async function digestFor(supabase, practice) {
  const since = weekAgoISO()
  const [{ count: consults }, outcomesRes] = await Promise.all([
    supabase.from('consults').select('id', { count: 'exact', head: true }).eq('practice_id', practice.id).gte('created_at', since),
    supabase.from('message_outcomes').select('consult_id, message_position, replied, replied_at, sent_at, closed_after, closed_at, treatment_value').eq('practice_id', practice.id),
  ])
  const outcomes = outcomesRes.data || []
  const weekOut = outcomes.filter((o) => o.sent_at && o.sent_at >= since)
  const sequences = new Set(weekOut.map((o) => o.consult_id)).size
  const replies = outcomes.filter((o) => o.replied_at && o.replied_at >= since).length

  const pos = {}
  for (const o of outcomes) { const k = o.message_position; if (!k) continue; pos[k] = pos[k] || { n: 0, r: 0 }; pos[k].n++; if (o.replied) pos[k].r++ }
  const best = Object.entries(pos).map(([k, v]) => ({ k, rate: v.r / v.n, n: v.n })).sort((a, b) => b.rate - a.rate)[0]
  const bestMessage = best ? `Message ${best.k} - ${pct(best.rate)} reply rate (${best.n} sent)` : 'Not enough data yet'

  const recovered = new Map()
  for (const o of outcomes) { if (o.closed_after && o.closed_at && o.closed_at >= since) recovered.set(o.consult_id, Number(o.treatment_value) || 0) }
  const recoveredValue = [...recovered.values()].reduce((a, b) => a + b, 0)

  const { data: topObj } = await supabase.from('consults').select('objection_type').eq('practice_id', practice.id).not('objection_type', 'is', null).limit(200)
  const objCount = {}
  for (const c of topObj || []) objCount[c.objection_type] = (objCount[c.objection_type] || 0) + 1
  const commonObj = Object.entries(objCount).sort((a, b) => b[1] - a[1])[0]?.[0]
  let insight = null
  if (commonObj) {
    const { data: ni } = await supabase.from('network_insights').select('finding, recommendation').eq('objection_type', commonObj).order('confidence_score', { ascending: false }).limit(1)
    insight = ni?.[0] || null
  }
  return { consults: consults || 0, sequences, replies, bestMessage, recoveredCount: recovered.size, recoveredValue, insight }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const RESEND = Deno.env.get('RESEND_API_KEY')
    const FROM = Deno.env.get('DIGEST_FROM_EMAIL') || 'Hope AI <digest@heyhope.ai>'
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
    const body = await req.json().catch(() => ({}))

    let q = supabase.from('practices').select('id, name, email').not('email', 'is', null)
    if (body.practice_id) q = supabase.from('practices').select('id, name, email').eq('id', body.practice_id)
    const { data: practices, error } = await q
    if (error) return json({ error: error.message }, 400)

    const results = []
    for (const p of practices || []) {
      const d = await digestFor(supabase, p)
      const html = buildHtml(p, d)
      if (!RESEND) { results.push({ practice: p.id, sent: false, reason: 'RESEND_API_KEY not configured', preview: d }); continue }
      if (!p.email) { results.push({ practice: p.id, sent: false, reason: 'No email on file' }); continue }
      const send = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: p.email, subject: 'Hope AI Weekly - Your practice intelligence update', html }),
      })
      results.push({ practice: p.id, sent: send.ok, status: send.status })
    }
    return json({ ok: true, configured: Boolean(RESEND), count: results.length, results })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
