import { reportEdgeError } from "../_shared/report-error.ts";
// cancel-subscription - cancels a practice's Chargebee subscription and flips
// its status. Runs with the caller's JWT so RLS confirms ownership. Degrades
// gracefully when Chargebee isn't configured.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { chargebeeConfig, chargebeeRequest } from '../_shared/chargebee.ts'

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
      .select('id, chargebee_subscription_id, subscription_status')
      .eq('id', practice_id)
      .maybeSingle()
    if (pe) return json({ error: pe.message }, 400)
    if (!practice) return json({ error: 'Practice not found or not permitted' }, 404)

    let cbCancelled = false
    let cbError = null
    const cfg = chargebeeConfig()
    if (cfg && practice.chargebee_subscription_id) {
      try {
        // end_of_term: false cancels immediately; Chargebee also accepts
        // cancel_at_end_of_term for end-of-period cancellation.
        await chargebeeRequest(cfg, `/subscriptions/${practice.chargebee_subscription_id}/cancel_for_items`, 'POST', {
          end_of_term: true,
        })
        cbCancelled = true
      } catch (e) {
        cbError = String(e?.message || e)
      }
    }

    const { error: ue } = await supabase.from('practices').update({ subscription_status: 'cancelled' }).eq('id', practice_id)
    if (ue) return json({ error: ue.message }, 400)

    return json({ ok: true, cb_cancelled: cbCancelled, cb_error: cbError })
  } catch (e) {
    await reportEdgeError("cancel-subscription", e);
    return json({ error: String(e?.message || e) }, 500)
  }
})
