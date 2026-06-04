import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { queryClient } from './lib/queryClient'
import { reportError } from './lib/errorReporting'

// Global catch-alls: report any uncaught error / promise rejection to Slack.
window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason, { extra: 'Unhandled promise rejection' })
})
window.onerror = (message, source, lineno, colno, error) => {
  reportError(error || new Error(message), { extra: source + ":" + lineno + ":" + colno })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
