// Twilio Voice (browser dialer) helpers.
import { supabase } from './supabase'

// Mint a Twilio AccessToken for the signed-in user's practice. Throws with a
// `.code` of 'twilio_voice_not_configured' when Twilio isn't set up yet so the
// dialer can fall back to a tel: link.
export async function fetchVoiceToken() {
  const { data, error } = await supabase.functions.invoke('twilio-voice-token', { body: {} })
  if (error) throw new Error(error.message || 'Could not start the dialer.')
  if (data?.error) {
    const e = new Error(data.error)
    e.code = data.code
    throw e
  }
  return data // { token, identity, expires_in }
}

export function formatCallTime(secs) {
  const s = Math.max(0, Math.floor(secs || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Recent calls for the practice, newest first (joins the consult for a name).
export async function fetchRecentCalls(practiceId, limit = 20) {
  if (!practiceId) return []
  const { data } = await supabase
    .from('call_logs')
    .select('id, to_number, duration_seconds, disposition, recording_url, recording_duration, created_at, consults(patient_name)')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return data || []
}

// Fetch a recording through the authenticated proxy and return a playable
// object URL (Twilio media needs auth, so we can't point <audio> at it directly).
// Caller is responsible for URL.revokeObjectURL when done.
export async function loadRecordingUrl(callLogId) {
  const { data: { session } } = await supabase.auth.getSession()
  const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const res = await fetch(`${base}/functions/v1/twilio-recording-audio?id=${encodeURIComponent(callLogId)}`, {
    headers: {
      Authorization: `Bearer ${session?.access_token || ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    },
  })
  if (!res.ok) throw new Error('Could not load recording.')
  return URL.createObjectURL(await res.blob())
}
