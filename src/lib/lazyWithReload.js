import { lazy } from 'react'

// After a deploy, Vite's hashed chunk filenames change. A tab that lazy-loads a
// chunk from the OLD build then 404s on import() → React throws → the error
// boundary shows "Something went wrong". The fix: treat a chunk-load failure as
// "you're on a stale build" and do a single full reload to fetch the new one.

const RELOAD_KEY = 'cl_chunk_reload_ts'

export function isChunkLoadError(err) {
  const msg = String(err?.message || err || '')
  const name = String(err?.name || '')
  return (
    name === 'ChunkLoadError' ||
    /dynamically imported module|importing a module script failed|failed to fetch dynamically|error loading dynamically imported module|loading chunk \d+ failed|loading css chunk|module script failed|expected a javascript module script|unable to preload/i.test(msg)
  )
}

// Force one full reload to pull the latest build. Loop-guarded: won't reload
// again within 12s (so a genuinely-missing chunk can't reload forever).
export function reloadForFreshBuild() {
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0 } catch { /* storage unavailable */ }
  if (Date.now() - last < 12000) return false
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* noop */ }
  window.location.reload()
  return true
}

// Drop-in replacement for React.lazy that survives stale chunks: on a chunk-load
// failure it reloads immediately to fetch the new build (no retry round-trip —
// the chunk is genuinely gone after a deploy, so retrying just adds a second of
// delay) and keeps Suspense's loader up meanwhile, so the user sees a normal
// loading state, never an error. Non-chunk errors rethrow so real bugs surface.
export function lazyWithReload(factory) {
  return lazy(async () => {
    try {
      return await factory()
    } catch (err) {
      if (isChunkLoadError(err) && reloadForFreshBuild()) {
        return new Promise(() => {}) // reload underway; hold the Suspense loader
      }
      throw err
    }
  })
}
