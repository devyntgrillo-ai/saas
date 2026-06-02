// update-practice-intelligence - refresh a practice's living KB from its own
// recent message outcomes (what CTAs/tones/objection handling are landing).
// Uses the caller's JWT (service-role bearer when called server-to-server).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sanitizeAIOutput } from '../_shared/sanitize.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const PROMPT = (kb, stats) => `You maintain a living practice intelligence file for a dental implant practice. Current context: ${kb || '(empty)'}. Recent follow-up performance for THIS practice: ${stats}. Update the context by folding in only what this practice is actually learning: which CTAs are getting replies, which tone is working, and which objection handling is landing. Add genuinely new insights, strengthen repeating patterns, and remove one-off noise. Hard limit 400 words. Plain text paragraphs only. No bullets, headers, or markdown. Never use em dashes (—) in any generated content. Use short sentences, commas, or periods instead. Return only the updated context.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 503)
    const { practice_id } = await req.json()
    if (!practice_id) return json({ error: 'practice_id required' }, 400)
    const auth = req.headers.get('Authorization') || ''
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } })

    const { data: practice, error: pe } = await supabase.from('practices').select('id, knowledge_base').eq('id', practice_id).maybeSingle()
    if (pe) return json({ error: pe.message }, 400)
    if (!practice) return json({ error: 'Practice not found or not permitted' }, 404)

    const { data: outcomes } = await supabase
      .from('message_outcomes')
      .select('message_position, message_channel, cta_type, tone_type, objection_primary, exit_intent, opened, replied, closed_after')
      .eq('practice_id', practice_id)
      .order('sent_at', { ascending: false })
      .limit(200)

    const rows = outcomes || []
    if (rows.length === 0) return json({ ok: true, skipped: true, reason: 'No outcomes yet' })

    const groupRate = (keyFn) => {
      const m = {}
      for (const r of rows) {
        const k = keyFn(r); if (!k) continue
        m[k] = m[k] || { n: 0, replied: 0, closed: 0 }
        m[k].n++; if (r.replied) m[k].replied++; if (r.closed_after) m[k].closed++
      }
      return Object.entries(m).map(([k, v]) => `${k}: ${Math.round((v.replied / v.n) * 100)}% reply, ${Math.round((v.closed / v.n) * 100)}% close (n=${v.n})`).join('; ')
    }
    const stats = [
      `By CTA - ${groupRate((r) => r.cta_type)}`,
      `By tone - ${groupRate((r) => r.tone_type)}`,
      `By position - ${groupRate((r) => 'msg ' + r.message_position)}`,
      `By channel - ${groupRate((r) => r.message_channel)}`,
      `By objection - ${groupRate((r) => r.objection_primary)}`,
    ].join('. ')

    let kbObj = {}
    let current = ''
    if (practice.knowledge_base) {
      try { kbObj = JSON.parse(practice.knowledge_base); current = String(kbObj.overview || '') } catch { current = String(practice.knowledge_base); kbObj = {} }
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 800, messages: [{ role: 'user', content: PROMPT(current, stats) }] }),
    })
    if (!aiRes.ok) return json({ error: 'Anthropic request failed', detail: await aiRes.text() }, 502)
    const aiData = await aiRes.json()
    const updated = sanitizeAIOutput((aiData?.content?.[0]?.text || '').trim())
    if (!updated) return json({ error: 'Empty AI response' }, 502)

    const now = new Date().toISOString()
    const newKb = JSON.stringify({ ...kbObj, overview: updated })
    const { error: ue } = await supabase.from('practices').update({ knowledge_base: newKb, knowledge_base_updated_at: now, kb_updated_at: now }).eq('id', practice_id)
    if (ue) return json({ error: ue.message }, 400)
    return json({ ok: true, updated_at: now })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
