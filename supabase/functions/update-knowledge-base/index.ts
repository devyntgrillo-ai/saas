// update-knowledge-base
// ----------------------------------------------------------------------------
// After a consult is analyzed/approved, fold its insights into the practice's
// living "intelligence file". Runs with the caller's JWT so RLS restricts it to
// the caller's own practice. No PHI is sent - only the de-identified analysis.
//
// Secrets required: ANTHROPIC_API_KEY (already set for analyze-consult).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sanitizeAIOutput } from '../_shared/sanitize.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const KB_PROMPT = (knowledgeBase: string, analysis: string) =>
  `You maintain a living practice intelligence file. Current context: ${knowledgeBase}. New consult analysis: ${analysis}. Update the context by adding only genuinely new insights, strengthening patterns that repeat, and removing one-off noise. Hard limit 400 words. Plain text paragraphs only. No bullets, headers, or markdown. Never use em dashes (—) in any generated content. Use short sentences, commas, or periods instead. Return only the updated context.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 503)

    const { consult_id } = await req.json()
    if (!consult_id) return json({ error: 'consult_id required' }, 400)

    const authHeader = req.headers.get('Authorization') || ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Load the consult (RLS-scoped to the caller's practice).
    const { data: consult, error: ce } = await supabase
      .from('consults')
      .select(
        'id, practice_id, what_happened, objection_type, primary_objection, secondary_objection, exit_intent, exit_intent_level, coaching_insight, downsell_opportunity, tc_action, personal_detail'
      )
      .eq('id', consult_id)
      .maybeSingle()
    if (ce) return json({ error: ce.message }, 400)
    if (!consult) return json({ error: 'Consult not found' }, 404)

    const { data: practice, error: pe } = await supabase
      .from('practices')
      .select('id, knowledge_base')
      .eq('id', consult.practice_id)
      .maybeSingle()
    if (pe) return json({ error: pe.message }, 400)

    // The structured KB is stored as JSON; the AI-maintained narrative lives in
    // its `overview` field. Fall back to treating any non-JSON value as raw text.
    let kbObj: Record<string, unknown> = {}
    let currentContext = ''
    if (practice?.knowledge_base) {
      try {
        kbObj = JSON.parse(practice.knowledge_base)
        currentContext = String(kbObj.overview || '')
      } catch {
        currentContext = String(practice.knowledge_base)
        kbObj = {}
      }
    }

    const analysis = [
      consult.what_happened && `Summary: ${consult.what_happened}`,
      consult.objection_type && `Primary objection type: ${consult.objection_type}`,
      consult.primary_objection && `Primary objection: ${consult.primary_objection}`,
      consult.secondary_objection && `Secondary objection: ${consult.secondary_objection}`,
      consult.exit_intent_level && `Exit intent: ${consult.exit_intent_level}`,
      consult.exit_intent && `Exit intent detail: ${consult.exit_intent}`,
      consult.coaching_insight && `Coaching insight: ${consult.coaching_insight}`,
      consult.downsell_opportunity && `Downsell opportunity: ${consult.downsell_opportunity}`,
      consult.tc_action && `Recommended TC action: ${consult.tc_action}`,
      consult.personal_detail && `Personal detail: ${consult.personal_detail}`,
    ]
      .filter(Boolean)
      .join('. ')

    if (!analysis) return json({ skipped: true, reason: 'No analysis to fold in' })

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: KB_PROMPT(currentContext || '(empty)', analysis) }],
      }),
    })

    if (!aiRes.ok) {
      const text = await aiRes.text()
      return json({ error: 'Anthropic request failed', detail: text }, 502)
    }

    const aiData = await aiRes.json()
    const updated = sanitizeAIOutput((aiData?.content?.[0]?.text || '').trim())
    if (!updated) return json({ error: 'Empty AI response' }, 502)

    const now = new Date().toISOString()
    const newKb = JSON.stringify({ ...kbObj, overview: updated })

    const { error: ue } = await supabase
      .from('practices')
      .update({ knowledge_base: newKb, knowledge_base_updated_at: now, kb_updated_at: now })
      .eq('id', consult.practice_id)
    if (ue) return json({ error: ue.message }, 400)

    return json({ ok: true, updated_at: now })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
