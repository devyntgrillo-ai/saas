import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { queryClient } from './lib/queryClient'
import { reportError } from './lib/errorReporting'
import { isChunkLoadError, reloadForFreshBuild } from './lib/lazyWithReload'

// Vite fires this when a preloaded module (lazy chunk) fails to load — almost
// always because a new build shipped and the old hashed chunk is gone. Reload
// to the fresh build instead of surfacing an error.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault?.()
  reloadForFreshBuild()
})

// Global catch-alls: report any uncaught error / promise rejection to Slack —
// except stale-chunk errors, which we recover from by reloading (not real bugs).
window.addEventListener('unhandledrejection', (event) => {
  if (isChunkLoadError(event.reason)) { reloadForFreshBuild(); return }
  reportError(event.reason, { extra: 'Unhandled promise rejection' })
})
window.onerror = (message, source, lineno, colno, error) => {
  if (isChunkLoadError(error || message)) { reloadForFreshBuild(); return }
  reportError(error || new Error(message), { extra: source + ":" + lineno + ":" + colno })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
