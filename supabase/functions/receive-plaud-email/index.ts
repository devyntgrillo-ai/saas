// receive-plaud-email - inbound webhook for Plaud AutoFlow forwarded emails
// (e.g. SendGrid Inbound Parse). Resolves the practice from the recipient
// address consults+{practice_id}@heyhope.ai, extracts the transcript, creates
// a consult, and kicks off analyze-consult. Always 200s to avoid retries.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    let to = '', text = '', subject = ''
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData()
      to = String(form.get('to') || form.get('envelope') || '')
      text = String(form.get('text') || form.get('email') || form.get('body') || '')
      subject = String(form.get('subject') || '')
    } else {
      const b = await req.json().catch(() => ({}))
      to = String(b.to || b.envelope || '')
      text = String(b.text || b.body || b.transcript || '')
      subject = String(b.subject || '')
    }

    const m = to.match(/consults\+([0-9a-fA-F-]{36})@/)
    const practiceId = m?.[1]
    if (!practiceId) return json({ ok: false, reason: 'could not resolve practice from recipient address' })

    const { data: practice } = await admin.from('practices').select('id').eq('id', practiceId).maybeSingle()
    if (!practice) return json({ ok: false, reason: 'unknown practice' })

    const transcript = (text || '').trim()
    if (!transcript) return json({ ok: false, reason: 'empty transcript' })

    const today = new Date()
    const { data: consult, error: ce } = await admin.from('consults').insert({
      practice_id: practiceId,
      status: 'analyzing',
      recording_source: 'plaud_autoflow',
      recording_date: today.toISOString().slice(0, 10),
      recording_time: today.toTimeString().slice(0, 8),
    }).select('id').single()
    if (ce) return json({ ok: false, reason: ce.message })

    fetch(`${SUPABASE_URL}/functions/v1/analyze-consult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ consult_id: consult.id, transcript, practice_id: practiceId, recording_source: 'plaud_autoflow' }),
    }).catch(() => {})

    return json({ ok: true, consult_id: consult.id, subject })
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) })
  }
})
