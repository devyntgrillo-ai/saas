import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

/**
 * HIPAA session security. Mounted once inside the Router + AuthProvider.
 *
 * 1. Idle timeout: signs the user out after 30 min of inactivity and sends them
 *    to /login with an "inactivity" reason. Only a bare timestamp is stored in
 *    localStorage (no PHI). Activity (click / keypress / scroll / touch) resets
 *    the timer; the timestamp is shared across tabs so activity in any tab keeps
 *    the session alive, and a timeout in one tab signs out the rest.
 * 2. Concurrent session warning: uses a Realtime presence channel keyed by a
 *    stable per-browser device id. If the same user is present from another
 *    device/browser, we surface a warning.
 */

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const CHECK_INTERVAL_MS = 5 * 60 * 1000 // every 5 minutes
const ACTIVITY_THROTTLE_MS = 15 * 1000 // cap localStorage writes
const ACTIVITY_KEY = 'cl_last_activity' // timestamp only, no PHI
const DEVICE_KEY = 'cl_device_id' // stable per browser profile
const SIGNOUT_REASON_KEY = 'cl_signout_reason' // read by Login
const CONCURRENT_DISMISS_KEY = 'cl_concurrent_ack' // per-tab acknowledgement

const now = () => Date.now()
const readActivity = () => {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0
  } catch {
    return 0
  }
}
const writeActivity = (t) => {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(t))
  } catch {
    /* storage unavailable; idle check simply won't fire */
  }
}
const clearActivity = () => {
  try {
    localStorage.removeItem(ACTIVITY_KEY)
  } catch {
    /* ignore */
  }
}
const getDeviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto?.randomUUID?.() || `${now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'device'
  }
}

export default function SessionSecurity() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = session?.user?.id || null

  const [concurrent, setConcurrent] = useState(false)
  const lastWriteRef = useRef(0)
  const signingOutRef = useRef(false)

  const markActivity = useCallback(() => {
    const t = now()
    if (t - lastWriteRef.current < ACTIVITY_THROTTLE_MS) return
    lastWriteRef.current = t
    writeActivity(t)
  }, [])

  const endSession = useCallback(
    async (reason) => {
      if (signingOutRef.current) return
      signingOutRef.current = true
      try {
        sessionStorage.setItem(SIGNOUT_REASON_KEY, reason)
      } catch {
        /* ignore */
      }
      clearActivity()
      try {
        await signOut()
      } catch {
        /* sign out is best-effort; we still redirect */
      }
      navigate('/login', { replace: true })
    },
    [signOut, navigate]
  )

  const checkIdle = useCallback(() => {
    const last = readActivity()
    if (last && now() - last >= IDLE_TIMEOUT_MS) endSession('inactivity')
  }, [endSession])

  // Reset the timer on a fresh sign-in; clear it on sign-out so a later login on
  // the same browser doesn't inherit a stale (expired) timestamp.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        signingOutRef.current = false
        writeActivity(now())
      } else if (event === 'SIGNED_OUT') {
        clearActivity()
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Idle tracking: activity listeners + periodic and event-driven checks.
  useEffect(() => {
    if (!userId) return
    signingOutRef.current = false
    if (!readActivity()) writeActivity(now()) // seed on first load of an existing session

    const onActivity = () => markActivity()
    const events = ['click', 'keydown', 'scroll', 'touchstart']
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkIdle()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', checkIdle)

    const interval = setInterval(checkIdle, CHECK_INTERVAL_MS)
    checkIdle() // immediate

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity))
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', checkIdle)
      clearInterval(interval)
    }
  }, [userId, markActivity, checkIdle])

  // Check on every route change (and treat navigating as activity).
  useEffect(() => {
    if (!userId) return
    const last = readActivity()
    if (last && now() - last >= IDLE_TIMEOUT_MS) endSession('inactivity')
    else markActivity()
  }, [location.pathname, userId, endSession, markActivity])

  // Concurrent-session detection via Realtime presence.
  useEffect(() => {
    if (!userId) {
      // Deliberate reset when the session ends (not a render loop).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConcurrent(false)
      return
    }
    const deviceId = getDeviceId()
    let cancelled = false
    const channel = supabase.channel(`presence-user-${userId}`, {
      config: { presence: { key: deviceId } },
    })
    const evaluate = () => {
      const state = channel.presenceState() || {}
      const others = Object.keys(state).filter((k) => k !== deviceId)
      let acked = false
      try {
        acked = sessionStorage.getItem(CONCURRENT_DISMISS_KEY) === '1'
      } catch {
        /* ignore */
      }
      if (!cancelled) setConcurrent(others.length > 0 && !acked)
    }
    channel
      .on('presence', { event: 'sync' }, evaluate)
      .on('presence', { event: 'join' }, evaluate)
      .on('presence', { event: 'leave' }, evaluate)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ device: deviceId, ua: (navigator.userAgent || '').slice(0, 120), ts: now() })
        }
      })
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [userId])

  const acknowledge = useCallback(() => {
    try {
      sessionStorage.setItem(CONCURRENT_DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setConcurrent(false)
  }, [])

  const secureAccount = useCallback(() => {
    endSession('concurrent')
  }, [endSession])

  if (!userId || !concurrent) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-3">
      <div
        role="alert"
        className="flex w-full max-w-2xl items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg"
      >
        <span aria-hidden="true" className="text-lg">⚠️</span>
        <p className="flex-1 text-sm text-amber-900">
          Your account was accessed from another location. Was this you?
        </p>
        <button
          onClick={acknowledge}
          className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-700"
        >
          Yes, it was me
        </button>
        <button
          onClick={secureAccount}
          className="shrink-0 rounded-lg border border-amber-400 px-3 py-1.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
        >
          No, sign me out
        </button>
      </div>
    </div>
  )
}
