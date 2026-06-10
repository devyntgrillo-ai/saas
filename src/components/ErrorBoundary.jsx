import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { reportError } from '../lib/errorReporting'
import { isChunkLoadError, reloadForFreshBuild } from '../lib/lazyWithReload'
import LoadingScreen from './LoadingScreen'

// App-wide error boundary: catches uncaught React render errors, reports them to
// Slack (#caselift-errors), and shows a recovery screen instead of a blank page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // A stale-chunk failure after a deploy is not a real bug: the user is on an
    // old build whose hashed chunks are gone. Reload to the new build instead of
    // reporting noise and showing the scary error screen.
    if (isChunkLoadError(error)) {
      reloadForFreshBuild()
      return
    }
    console.error('[CaseLift] render error', error, info)
    reportError(error, {
      extra: `React render error${info?.componentStack ? ` · ${info.componentStack.trim().split('\n')[1]?.trim() || ''}` : ''}`,
    })
  }

  render() {
    if (this.state.hasError) {
      // Stale-chunk error → a reload is already underway. Render the SAME branded
      // loading screen the app uses on boot, so the brief moment before the reload
      // takes over looks like normal loading, not an error.
      if (isChunkLoadError(this.state.error)) {
        return <LoadingScreen />
      }
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface p-6">
          <div className="card max-w-md p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-white">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-400">
              An unexpected error occurred and our team has been notified. Reloading usually fixes it.
            </p>
            <button onClick={() => window.location.reload()} className="btn-primary mt-6">
              <RefreshCw className="h-4 w-4" /> Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
