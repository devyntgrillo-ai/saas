import { useNavigate } from 'react-router-dom'
import { AlertTriangle, LogOut } from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'

// Standalone lockout screen for users whose practice has been archived. No
// sidebar / nav, ProtectedRoute routes suspended users straight here.
export default function Suspended() {
  const { practice, signOut } = useAuth()
  const navigate = useNavigate()

  const practiceName = practice?.name || 'your account'
  const resellerName = practice?.agency?.name || null

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="mb-8">
        <Logo size="lg" showBeta={false} />
      </div>

      <div className="w-full max-w-md rounded-2xl border border-surface-700 bg-surface-900 p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15">
          <AlertTriangle className="h-7 w-7 text-amber-400" />
        </div>

        <h1 className="mt-5 text-xl font-bold text-white">Your account has been paused</h1>

        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          Access to <span className="font-semibold text-slate-200">{practiceName}</span> has been
          temporarily suspended. Please contact your administrator to restore access.
        </p>

        {resellerName && (
          <p className="mt-4 rounded-lg border border-surface-700 bg-surface-800/50 px-4 py-2.5 text-sm text-slate-300">
            Contact: <span className="font-semibold text-white">{resellerName}</span>
          </p>
        )}

        <button onClick={handleSignOut} className="btn-secondary mt-7 w-full justify-center">
          <LogOut className="h-4 w-4" /> Sign Out
        </button>
      </div>
    </div>
  )
}
