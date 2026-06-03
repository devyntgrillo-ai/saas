import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Gates the app behind onboarding completion for practice (non-agency) users.
// Runs inside the BAA gate, so a session + accepted BAA are already guaranteed.
export default function RequireOnboarding({ children }) {
  const { contextLoading, isAgencyUser, practiceId, onboardingCompleted } = useAuth()
  const location = useLocation()

  if (contextLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-700 border-t-primary" />
      </div>
    )
  }

  // Agency users (and impersonation) skip the onboarding wizard entirely.
  if (isAgencyUser) return children

  // A practice user who hasn't finished setup goes to the wizard.
  if (practiceId && !onboardingCompleted) {
    return <Navigate to="/onboarding" replace state={{ from: location }} />
  }

  return children
}
