import { useEffect, useState } from 'react'

// A tiny client-side record of consults the user *just* submitted from the
// recorder. Backend analysis often completes in a few seconds, which means the
// DB-driven "processing" cards (status analyzing/transcribed) can flash by
// before the user even navigates to a list. This guarantees the animated
// "AI is analyzing…" card shows for a short, satisfying window after recording,
// on whatever page they land on, then it hands back to the real DB state.
const KEY = 'ciq_recent_recordings'
const STORE_TTL_MS = 60_000 // keep entries in storage at most a minute
const EVENT = 'ciq-recent-recordings'

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable */
  }
  // Notify same-tab listeners (the native 'storage' event only fires cross-tab).
  window.dispatchEvent(new Event(EVENT))
}

// Mark a consult as just-recorded. Called from the recorder the instant the
// placeholder consult row is created.
export function markRecording({ id, practiceId }) {
  if (!id) return
  const now = Date.now()
  const list = read().filter((r) => r.id !== id && now - r.ts < STORE_TTL_MS)
  // Only id/practiceId/ts, never the patient name (PHI must not hit localStorage).
  // Consumers key off id and ts only; the name was never read.
  list.push({ id, practiceId: practiceId || null, ts: now })
  write(list)
}

// The timestamp (ms) a consult was recorded, if we still have it locally, used
// as an instant anchor for the processing-screen progress bar before the DB
// created_at loads. Returns null when unknown.
export function recordingStartedAt(id) {
  if (!id) return null
  const entry = read().find((r) => r.id === id)
  return entry ? entry.ts : null
}

function snapshot(practiceId, windowMs) {
  if (!practiceId) return []
  const now = Date.now()
  return read().filter((r) => r.practiceId === practiceId && now - r.ts < windowMs)
}

// Live list of consults recorded within the last `windowMs`, scoped to a
// practice. Updates when a recording is added (custom event), cross-tab
// (storage event), and on a 1s tick so cards age out on their own.
export function useRecentRecordings(practiceId, windowMs = 20_000) {
  const [items, setItems] = useState(() => snapshot(practiceId, windowMs))
  useEffect(() => {
    const refresh = () =>
      setItems((prev) => {
        const next = snapshot(practiceId, windowMs)
        // Keep the same reference when nothing changed, to avoid re-renders.
        if (prev.length === next.length && prev.every((p, i) => p.id === next[i].id)) return prev
        return next
      })
    // Lazy useState init covers the first render; resync shortly after for
    // practiceId changes via the 1s tick below (and immediately on markRecording).
    const t = setInterval(refresh, 1000)
    window.addEventListener(EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      clearInterval(t)
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [practiceId, windowMs])
  return items
}
