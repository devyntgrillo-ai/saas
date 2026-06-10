// Twilio Voice (browser dialer) helpers + React hook for in-app calling.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// Mint a Twilio AccessToken for the signed-in user's practice. Throws with a
// `.code` of 'twilio_voice_not_configured' when Twilio isn't set up yet so the
// dialer can fall back to a tel: link.
export async function fetchVoiceToken() {
  const { data, error, response } = await supabase.functions.invoke('twilio-voice-token', { body: {} })
  if (error) {
    let message = error.message || 'Could not start the dialer.'
    if (response && typeof response.json === 'function') {
      try {
        const payload = await response.json()
        if (payload?.error) message = payload.error
        if (payload?.code) {
          const e = new Error(message)
          e.code = payload.code
          throw e
        }
      } catch (parseErr) {
        if (parseErr?.code) throw parseErr
      }
    }
    throw new Error(message)
  }
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
  if (!res.ok) {
    let message = 'Could not load recording.'
    try {
      const payload = await res.json()
      if (payload?.error) message = payload.error
    } catch {
      /* non-JSON body */
    }
    throw new Error(message)
  }
  return URL.createObjectURL(await res.blob())
}

/**
 * Browser Twilio Voice device for Conversations / Power Dialer.
 * @param {{ enabled?: boolean }} opts, when true, pre-warms the device (token + register).
 */
export function useTwilioVoiceDevice({ enabled = true } = {}) {
  const deviceRef = useRef(null)
  const callRef = useRef(null)
  const callSidRef = useRef(null)
  const callDirectionRef = useRef(null)
  const onEndedRef = useRef(null)
  const secondsRef = useRef(0)

  const [voiceState, setVoiceState] = useState('init') // init | ready | unavailable
  const [callState, setCallState] = useState('idle') // idle | incoming | connecting | ringing | in_call
  const [callDirection, setCallDirection] = useState(null) // inbound | outbound | null
  const [incomingFrom, setIncomingFrom] = useState('')
  const [incomingMeta, setIncomingMeta] = useState(null) // { conversationId, callLogId }
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)

  const destroyDevice = useCallback(() => {
    try {
      callRef.current?.disconnect()
    } catch {
      /* noop */
    }
    try {
      deviceRef.current?.destroy()
    } catch {
      /* noop */
    }
    callRef.current = null
    deviceRef.current = null
    callSidRef.current = null
    callDirectionRef.current = null
    setCallState('idle')
    setCallDirection(null)
    setIncomingFrom('')
    setIncomingMeta(null)
    setMuted(false)
    setSeconds(0)
    secondsRef.current = 0
  }, [])

  const ensureReady = useCallback(async (force = false) => {
    if (voiceState === 'ready' && deviceRef.current) return { ok: true }
    if (voiceState === 'unavailable' && !force) {
      return { ok: false, code: 'twilio_voice_not_configured', error: 'Voice calling is not configured.' }
    }
    try {
      const { token } = await fetchVoiceToken()
      const { Device } = await import('@twilio/voice-sdk')
      if (deviceRef.current) {
        try {
          deviceRef.current.destroy()
        } catch {
          /* noop */
        }
      }
      const device = new Device(token, { codecPreferences: ['opus', 'pcmu'], logLevel: 'error' })
      device.on('tokenWillExpire', async () => {
        try {
          const { token: t } = await fetchVoiceToken()
          device.updateToken(t)
        } catch {
          /* keep going */
        }
      })
      device.on('error', (e) => console.error('Twilio device error:', e?.message || e))
      device.on('incoming', (call) => {
        if (callRef.current) {
          try {
            call.reject()
          } catch {
            /* noop */
          }
          return
        }
        callRef.current = call
        callDirectionRef.current = 'inbound'
        setCallDirection('inbound')
        setIncomingFrom(call.parameters?.From || call.customParameters?.get?.('from') || 'Unknown')
        setIncomingMeta({
          conversationId: call.customParameters?.get?.('conversation_id') || null,
          callLogId: call.customParameters?.get?.('call_log_id') || null,
        })
        setCallState('incoming')
        const end = () => resetCallUi()
        call.on('cancel', end)
        call.on('disconnect', end)
        call.on('reject', end)
        call.on('error', (e) => {
          console.error('Twilio inbound call error:', e?.message || e)
          end()
        })
      })
      await device.register()
      deviceRef.current = device
      setVoiceState('ready')
      return { ok: true }
    } catch (e) {
      console.error('Twilio voice init failed:', e)
      setVoiceState('unavailable')
      return { ok: false, error: e?.message || String(e), code: e?.code }
    }
  }, [voiceState])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      const result = await ensureReady()
      if (cancelled && result?.ok && deviceRef.current) {
        deviceRef.current.destroy()
        deviceRef.current = null
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, ensureReady])

  useEffect(() => {
    if (!enabled) destroyDevice()
    return () => destroyDevice()
  }, [enabled, destroyDevice])

  useEffect(() => {
    if (callState !== 'in_call') return
    const t = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1
        secondsRef.current = next
        return next
      })
    }, 1000)
    return () => clearInterval(t)
  }, [callState])

  const resetCallUi = useCallback(() => {
    callRef.current = null
    const sid = callSidRef.current
    const dur = secondsRef.current
    const direction = callDirectionRef.current
    callSidRef.current = null
    callDirectionRef.current = null
    setCallState('idle')
    setCallDirection(null)
    setIncomingFrom('')
    setIncomingMeta(null)
    setMuted(false)
    setSeconds(0)
    secondsRef.current = 0
    const cb = onEndedRef.current
    onEndedRef.current = null
    if (cb) cb({ callSid: sid || null, seconds: dur, direction })
  }, [])

  const placeCall = useCallback(
    async ({ to, practiceId, consultId, conversationId, onEnded }) => {
      const device = deviceRef.current
      if (!device || !to || callState !== 'idle') return false
      onEndedRef.current = onEnded || null
      setSeconds(0)
      secondsRef.current = 0
      setMuted(false)
      callDirectionRef.current = 'outbound'
      setCallDirection('outbound')
      setCallState('connecting')
      try {
        const params = { To: to, practice_id: practiceId || '' }
        if (consultId) params.consult_id = consultId
        if (conversationId) params.conversation_id = conversationId
        const call = await device.connect({ params })
        callRef.current = call
        call.on('ringing', () => setCallState('ringing'))
        call.on('accept', () => {
          callSidRef.current = call.parameters?.CallSid || null
          setCallState('in_call')
        })
        const end = () => resetCallUi()
        call.on('disconnect', end)
        call.on('cancel', end)
        call.on('reject', end)
        call.on('error', (e) => {
          console.error('Twilio call error:', e?.message || e)
          end()
        })
        return true
      } catch (e) {
        console.error('placeCall failed:', e)
        setCallState('idle')
        onEndedRef.current = null
        return false
      }
    },
    [callState, resetCallUi],
  )

  const acceptIncoming = useCallback(() => {
    const call = callRef.current
    if (!call || callState !== 'incoming') return false
    try {
      call.accept()
      call.on('accept', () => {
        callSidRef.current = call.parameters?.CallSid || null
        setCallState('in_call')
      })
      return true
    } catch (e) {
      console.error('acceptIncoming failed:', e)
      resetCallUi()
      return false
    }
  }, [callState, resetCallUi])

  const rejectIncoming = useCallback(() => {
    const call = callRef.current
    if (!call || callState !== 'incoming') return
    try {
      call.reject()
    } catch {
      /* noop */
    }
    resetCallUi()
  }, [callState, resetCallUi])

  const hangup = useCallback(() => {
    try {
      callRef.current?.disconnect()
    } catch {
      /* noop */
    }
  }, [])

  const toggleMute = useCallback(() => {
    const call = callRef.current
    if (!call) return
    const next = !muted
    try {
      call.mute(next)
      setMuted(next)
    } catch {
      /* noop */
    }
  }, [muted])

  return {
    voiceState,
    callState,
    callDirection,
    incomingFrom,
    incomingMeta,
    seconds,
    muted,
    ensureReady,
    placeCall,
    acceptIncoming,
    rejectIncoming,
    hangup,
    toggleMute,
    destroyDevice,
  }
}
