import { useNavigate } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// GHL-style impersonation bar. Sits at the very top of the app shell (above the
// nav) and stays visible the whole time a super-admin or reseller is viewing
// another account. Returns null when not impersonating, so it takes no space.
export default function ImpersonationBanner() {
  const { impersonation, isSuperAdmin, exitPractice } = useAuth()
  const navigate = useNavigate()

  if (!impersonation?.active) return null

  const { name, email } = impersonation.target || {}

  // End impersonation and return the viewer to their own home view.
  const switchToMyAccount = () => {
    exitPractice()
    navigate(isSuperAdmin ? '/admin' : '/agency')
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-blue-100 px-4 py-2 text-sm text-blue-900">
      <span className="flex min-w-0 items-center gap-2">
        <Eye className="h-4 w-4 shrink-0 text-blue-700" />
        <span className="truncate">
          Logged in as <span className="font-semibold">{name}</span>
          {email && <span className="text-blue-700"> ({email})</span>}
        </span>
      </span>
      <button
        onClick={switchToMyAccount}
        className="shrink-0 font-semibold text-blue-700 underline-offset-2 transition hover:text-blue-900 hover:underline"
      >
        Switch to my account
      </button>
    </div>
  )
}
