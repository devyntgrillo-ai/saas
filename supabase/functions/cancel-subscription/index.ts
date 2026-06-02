// cancel-subscription - cancels a practice's Lemon Squeezy subscription and
// flips its status. Runs with the caller's JWT so RLS confirms ownership.
// Degrades gracefully when Lemon Squeezy isn't configured.
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
    const { practice_id } = await req.json()
    if (!practice_id) return json({ error: 'practice_id required' }, 400)
    const auth = req.headers.get('Authorization') || ''
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } })

    const { data: practice, error: pe } = await supabase
      .from('practices')
      .select('id, ls_subscription_id, subscription_status')
      .eq('id', practice_id)
      .maybeSingle()
    if (pe) return json({ error: pe.message }, 400)
    if (!practice) return json({ error: 'Practice not found or not permitted' }, 404)

    let lsCancelled = false
    let lsError = null
    const apiKey = Deno.env.get('LEMONSQUEEZY_API_KEY')
    if (apiKey && practice.ls_subscription_id) {
      try {
        const res = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${practice.ls_subscription_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' },
        })
        lsCancelled = res.ok
        if (!res.ok) lsError = `Lemon Squeezy returned ${res.status}`
      } catch (e) {
        lsError = String(e?.message || e)
      }
    }

    const { error: ue } = await supabase.from('practices').update({ subscription_status: 'cancelled' }).eq('id', practice_id)
    if (ue) return json({ error: ue.message }, 400)

    return json({ ok: true, ls_cancelled: lsCancelled, ls_error: lsError })
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500)
  }
})
