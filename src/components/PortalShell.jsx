import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LogOut } from 'lucide-react'
import Logo from './Logo'
import { useAuth } from '../context/AuthContext'

// Full-page chrome for the standalone Admin / Reseller portals.
export default function PortalShell({ title, badgeClass = 'bg-surface-800 text-slate-300', tabs, children }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-surface-700 bg-surface-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            {title && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>{title}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="btn-ghost px-3 py-2 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to app
            </Link>
            <button
              onClick={async () => {
                await signOut()
                navigate('/login')
              }}
              title="Sign out"
              className="rounded-md p-2 text-slate-400 transition hover:bg-surface-800 hover:text-white"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
        {tabs && (
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">{tabs}</div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  )
}

export function PortalTab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={[
        '-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition',
        active ? 'border-primary text-white' : 'border-transparent text-slate-400 hover:text-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
