import { reportEdgeError } from "../_shared/report-error.ts";
// optimize-message - rewrite a single follow-up message using network insights
// + the practice knowledge base for that patient type. Uses the caller's JWT.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sanitizeAIOutput } from '../_shared/sanitize.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 503)
    const { message_id } = await req.json()
    if (!message_id) return json({ error: 'message_id required' }, 400)
    const auth = req.headers.get('Authorization') || ''
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } })

    const { data: msg, error: me } = await supabase.from('messages').select('id, body, subject, channel, consult_id, practice_id').eq('id', message_id).maybeSingle()
    if (me) return json({ error: me.message }, 400)
    if (!msg) return json({ error: 'Message not found' }, 404)

    const { data: consult } = await supabase.from('consults').select('objection_type, exit_intent_level, primary_objection').eq('id', msg.consult_id).maybeSingle()
    const { data: practice } = await supabase.from('practices').select('knowledge_base').eq('id', msg.practice_id).maybeSingle()

    let kb = ''
    if (practice?.knowledge_base) { try { kb = String(JSON.parse(practice.knowledge_base).overview || '') } catch { kb = String(practice.knowledge_base) } }

    let insights = []
    if (consult?.objection_type) {
      const { data: ni } = await supabase.from('network_insights').select('finding, recommendation, message_channel, message_position, avg_reply_rate')
        .eq('objection_type', consult.objection_type).eq('exit_intent', consult.exit_intent_level)
        .order('confidence_score', { ascending: false }).limit(3)
      insights = ni || []
    }
    const insightText = insights.length ? insights.map((i) => `- ${i.finding} Recommendation: ${i.recommendation}`).join('\n') : 'No specific network insights for this patient type yet.'

    const prompt = `You are optimizing a single dental-implant follow-up message. Rewrite it to be more likely to get a reply for this patient type, using the practice intelligence and proven network insights below. Keep the same channel (${msg.channel}) and keep it natural and human. Preserve any template variables like {{first_name}}. Never use em dashes (—) in any generated content. Use short sentences, commas, or periods instead.\n\nPatient type: ${consult?.objection_type || 'unknown'} objection, ${consult?.exit_intent_level || 'unknown'} intent.\n\nPractice Intelligence:\n${kb || '(none yet)'}\n\nNetwork insights for this patient type:\n${insightText}\n\nCurrent message:\n${msg.body}\n\nReturn ONLY a JSON object: {"optimized": "the rewritten message", "explanation": "1-2 sentences on what changed and why"}. No markdown.`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!aiRes.ok) return json({ error: 'Anthropic request failed', detail: await aiRes.text() }, 502)
    const aiData = await aiRes.json()
    let text = (aiData?.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()
    let parsed
    try { parsed = JSON.parse(text) } catch { return json({ error: 'Could not parse AI response', raw: text }, 502) }
    return json({ ok: true, optimized: sanitizeAIOutput(parsed.optimized || ''), explanation: sanitizeAIOutput(parsed.explanation || ''), original: msg.body })
  } catch (e) {
    await reportEdgeError("optimize-message", e);
    return json({ error: String(e?.message || e) }, 500)
  }
})
