// Business Associate Agreement (BAA) acceptance.
import { supabase } from './supabase'

// Bump this whenever the BAA document text changes so acceptances are
// attributable to a specific version of the agreement.
export const BAA_VERSION = 'caselift-baa-2026-06'

// Record a BAA acceptance. Routes through the accept-baa edge function, which
// stamps the timestamp server-side and captures the signer's validated identity,
// the real client IP/user-agent, an immutable ledger row, and an audit event.
//
// Falls back to a direct timestamp write if the function is unreachable, so a
// transient outage can never lock a practice out of accepting (the BAA gate
// blocks the whole app until baa_accepted_at is set). Returns true on success.
export async function recordBaaAcceptance(practiceId) {
  try {
    const { data, error } = await supabase.functions.invoke('accept-baa', {
      body: { version: BAA_VERSION },
    })
    if (error) throw error
    if (data?.accepted_at) return true
    throw new Error('accept-baa returned no timestamp')
  } catch (e) {
    console.warn('[baa] accept-baa failed, falling back to direct timestamp:', e?.message || e)
    if (!practiceId) return false
    const { error } = await supabase
      .from('practices')
      .update({ baa_accepted_at: new Date().toISOString(), baa_version: BAA_VERSION })
      .eq('id', practiceId)
    return !error
  }
}
