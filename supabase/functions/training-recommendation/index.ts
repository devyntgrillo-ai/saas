import { reportEdgeError } from "../_shared/report-error.ts";
// training-recommendation - generate a short, personalized training focus
// recommendation for a practice based on patterns in their last 10 analyzed
// consults. Uses the caller's JWT (RLS-scoped reads).
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
    const { practice_id } = await req.json()
    if (!practice_id) return json({ error: 'practice_id required' }, 400)
    const auth = req.headers.get('Authorization') || ''
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } })

    // Last 10 analyzed consults (any post-analysis status).
    const { data: consults, error: ce } = await supabase
      .from('consults')
      .select('recording_date, status, outcome, objection_type, primary_objection, exit_intent_level, coaching_insight, tc_action, downsell_opportunity, what_happened')
      .eq('practice_id', practice_id)
      .in('status', ['analyzed', 'followed_up', 'recovered', 'lost'])
      .order('recording_date', { ascending: false })
      .limit(10)
    if (ce) return json({ error: ce.message }, 400)

    if (!consults || consults.length === 0) {
      return json({
        ok: true,
        based_on: 0,
        recommendation: 'Record and analyze a few consults to unlock a personalized training recommendation. Once we have analyzed consults, this card will highlight the exact skills your team should focus on.',
        focus_area: null,
      })
    }

    // Available training so the model can point at a concrete module/category.
    const { data: modules } = await supabase
      .from('training_modules')
      .select('title, category')
      .order('order_index', { ascending: true })
    const moduleList = (modules || []).map((m) => `- [${m.category}] ${m.title}`).join('\n') || '(no modules listed)'

    const consultSummary = consults
      .map((c, i) => {
        const parts = [
          `Consult ${i + 1} (${c.recording_date || 'date n/a'}, status: ${c.status}${c.outcome ? `, outcome: ${c.outcome}` : ''})`,
          c.objection_type ? `  objection: ${c.objection_type}${c.primary_objection ? ` - ${c.primary_objection}` : ''}` : null,
          c.exit_intent_level ? `  exit intent: ${c.exit_intent_level}` : null,
          c.what_happened ? `  what happened: ${c.what_happened}` : null,
          c.coaching_insight ? `  coaching insight: ${c.coaching_insight}` : null,
          c.tc_action ? `  recommended TC action: ${c.tc_action}` : null,
          c.downsell_opportunity ? `  downsell opportunity: ${c.downsell_opportunity}` : null,
        ].filter(Boolean)
        return parts.join('\n')
      })
      .join('\n\n')

    const prompt = `You are a sales coach for dental treatment coordinators (TCs). Their consults span many treatment types (implants, Invisalign, veneers, cosmetic, sleep apnea, perio, and more), so do not assume implants. Below are the practice's ${consults.length} most recent analyzed consults, plus the training modules available to them. Identify the single most valuable thing this team should study or practice next, based on recurring patterns across these consults (common objections, exit-intent mix, missed actions, lost outcomes).

Write a SHORT, specific, encouraging recommendation the TC reads on their Training page. Hard limit: at most 2 sentences, roughly 45 words. Name the one recurring pattern, then the single action plus the most relevant module to study next. Do NOT enumerate individual consult numbers. Name at most one module (a second only if it is truly complementary), and ONLY use modules that appear verbatim in the AVAILABLE TRAINING MODULES list, never invent one. Be direct. Never use em dashes (-) ; use commas or periods instead.

AVAILABLE TRAINING MODULES:
${moduleList}

RECENT CONSULTS:
${consultSummary}

Return ONLY a JSON object: {"recommendation": "the recommendation (<= 2 sentences)", "focus_area": "the single category or module name to focus on"}. No markdown.`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!aiRes.ok) return json({ error: 'Anthropic request failed', detail: await aiRes.text() }, 502)
    const aiData = await aiRes.json()
    const text = (aiData?.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim()
    let parsed
    try { parsed = JSON.parse(text) } catch { return json({ error: 'Could not parse AI response', raw: text }, 502) }
    return json({ ok: true, based_on: consults.length, recommendation: sanitizeAIOutput(parsed.recommendation || ''), focus_area: parsed.focus_area || null })
  } catch (e) {
    await reportEdgeError("training-recommendation", e);
    return json({ error: String(e?.message || e) }, 500)
  }
})
