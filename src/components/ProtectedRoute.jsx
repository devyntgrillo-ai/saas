import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthLoadingScreen from './AuthLoadingScreen'

export default function ProtectedRoute({ children }) {
  const { session, loading, isSuspended } = useAuth()
  const location = useLocation()

  if (loading) {
    return <AuthLoadingScreen />
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // Archived (suspended) practice users are locked out of the app entirely.
  if (isSuspended && location.pathname !== '/suspended') {
    return <Navigate to="/suspended" replace />
  }

  return children
}
