import { Component } from 'react'
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react'

// Inline error panel with a retry button. Use for failed data loads.
export default function ErrorState({
  title = 'Something went wrong',
  message = 'We couldn’t load this right now. Please try again.',
  onRetry,
  network = false,
  className = '',
}) {
  const Icon = network ? WifiOff : AlertTriangle
  return (
    <div className={`card flex flex-col items-center justify-center px-6 py-16 text-center ${className}`}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
        <Icon className="h-7 w-7" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-200">{title}</p>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-ghost mt-5">
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      )}
    </div>
  )
}

// Friendly message for a Supabase/PostgREST error object.
export function friendlyError(error) {
  if (!error) return ''
  const msg = error.message || String(error)
  if (/fetch|network|Failed to fetch/i.test(msg)) {
    return 'Network problem - check your connection and try again.'
  }
  if (/JWT|expired|not authenticated|401/i.test(msg)) {
    return 'Your session expired. Please sign in again.'
  }
  if (/permission|row-level security|42501/i.test(msg)) {
    return 'You don’t have access to this resource.'
  }
  return 'Something went wrong on our end. Please try again.'
}

// App-level boundary that catches render crashes so users see a recovery screen
// instead of a blank page.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // Surfaced for monitoring; replace with a real reporter in production.
    console.error('[CaseLift] render error', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface p-6">
          <div className="card max-w-md p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-white">Something broke</h1>
            <p className="mt-2 text-sm text-slate-400">
              An unexpected error occurred. Reloading usually fixes it.
            </p>
            <button onClick={() => window.location.reload()} className="btn-primary mt-6">
              <RefreshCw className="h-4 w-4" /> Reload app
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
