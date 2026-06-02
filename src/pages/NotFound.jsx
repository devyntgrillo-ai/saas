import { Link, useNavigate } from 'react-router-dom'
import { Compass, ArrowLeft, Home } from 'lucide-react'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-800 text-primary-400">
        <Compass className="h-8 w-8" />
      </div>
      <p className="mt-5 text-5xl font-bold tracking-tight text-white">404</p>
      <h1 className="mt-2 text-lg font-semibold text-slate-200">Page not found</h1>
      <p className="mt-1.5 max-w-sm text-sm text-slate-500">
        The page you’re looking for doesn’t exist or may have moved.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost">
          <ArrowLeft className="h-4 w-4" /> Go back
        </button>
        <Link to="/" className="btn-primary">
          <Home className="h-4 w-4" /> Dashboard
        </Link>
      </div>
    </div>
  )
}
