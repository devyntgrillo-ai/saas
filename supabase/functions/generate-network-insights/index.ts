// generate-network-insights - weekly cross-practice learning.
// Aggregates message_outcomes (sample>=10), asks Claude for plain-English
// insights, and replaces the network_insights table. Service-role (network-wide).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sanitizeAIOutput } from '../_shared/sanitize.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const PROMPT = (rows) => `You are analyzing performance data from dental implant follow-up sequences across multiple practices. Based on this data, generate specific, actionable insights about what messaging patterns are working best.

Data: ${JSON.stringify(rows)}

For each meaningful pattern you find, generate:
- finding: what is happening (e.g. 'SMS messages on day 3 with a direct booking CTA get 3x more replies for price-objection patients with warm intent')
- recommendation: exactly what to change (e.g. 'Change your Day 3 SMS CTA from a question to a direct offer: try ending with reply YES to hold a spot')

Also echo back the grouping keys for each insight so they can be matched: objection_type, exit_intent, message_position, message_channel, cta_type, and a confidence_score between 0 and 1.

Only include insights where the pattern is clear and sample size is meaningful.
Never use em dashes (—) in any generated content. Use short sentences, commas, or periods instead.
Return as JSON array of insight objects with keys: objection_type, exit_intent, message_position, message_channel, cta_type, finding, recommendation, confidence_score.
No markdown, no explanation, just the JSON.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 503)
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))

    const minSample = Number((await req.json().catch(() => ({}))).min_sample ?? 10)
    const { data: aggs, error: ae } = await supabase.rpc('get_network_aggregates', { min_sample: minSample })
    if (ae) return json({ error: ae.message }, 400)
    if (!aggs || aggs.length === 0) return json({ ok: true, skipped: true, reason: 'No groups meet the sample threshold yet', sample_threshold: minSample })

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, messages: [{ role: 'user', content: PROMPT(aggs) }] }),
    })
    if (!aiRes.ok) return json({ error: 'Anthropic request failed', detail: await aiRes.text() }, 502)
    const aiData = await aiRes.json()
    let text = (aiData?.content?.[0]?.text || '[]').replace(/```json|```/g, '').trim()
    let insights = []
    try { insights = JSON.parse(text) } catch { return json({ error: 'Could not parse AI JSON', raw: text }, 502) }
    if (!Array.isArray(insights)) insights = []

    const find = (i) => aggs.find((a) =>
      a.objection_type === i.objection_type && a.exit_intent === i.exit_intent &&
      Number(a.message_position) === Number(i.message_position) && a.cta_type === i.cta_type)

    const rows = insights.filter((i) => i.finding && i.recommendation).map((i) => {
      const agg = find(i) || {}
      return {
        insight_type: i.insight_type || 'pattern',
        objection_type: i.objection_type || null,
        exit_intent: i.exit_intent || null,
        message_position: i.message_position != null ? Number(i.message_position) : null,
        message_channel: i.message_channel || agg.message_channel || null,
        finding: sanitizeAIOutput(i.finding),
        recommendation: sanitizeAIOutput(i.recommendation),
        confidence_score: i.confidence_score != null ? Number(i.confidence_score) : 0.6,
        sample_size: agg.sample_size != null ? Number(agg.sample_size) : null,
        avg_reply_rate: agg.avg_reply_rate != null ? Number(agg.avg_reply_rate) : null,
        avg_close_rate: agg.avg_close_rate != null ? Number(agg.avg_close_rate) : null,
        last_updated: new Date().toISOString(),
      }
    })
    if (rows.length === 0) return json({ ok: true, generated: 0 })

    await supabase.from('network_insights').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    const { error: ie } = await supabase.from('network_insights').insert(rows)
    if (ie) return json({ error: ie.message }, 400)
    return json({ ok: true, generated: rows.length })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
