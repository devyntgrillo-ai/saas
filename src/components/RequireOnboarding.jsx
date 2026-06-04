import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthLoadingScreen from './AuthLoadingScreen'

// Gates the app behind onboarding completion for practice (non-agency) users.
// Runs inside the BAA gate, so a session + accepted BAA are already guaranteed.
export default function RequireOnboarding({ children }) {
  const { contextLoading, profileResolved, isAgencyUser, practiceId, onboardingCompleted } =
    useAuth()
  const location = useLocation()

  if (contextLoading || !profileResolved) {
    return <AuthLoadingScreen />
  }

  // Agency users (and impersonation) skip the onboarding wizard entirely.
  if (isAgencyUser) return children

  // A practice user who hasn't finished setup goes to the wizard.
  if (practiceId && !onboardingCompleted) {
    return <Navigate to="/onboarding" replace state={{ from: location }} />
  }

  return children
}
