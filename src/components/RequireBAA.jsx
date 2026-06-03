import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Gates the authenticated app behind BAA acceptance. A practice that hasn't
// accepted the Business Associate Agreement cannot reach any PHI-bearing screen.
// Users not yet linked to a practice are allowed through (they'll see the
// "finish setup" prompts); the BAA is stored on the practice record.
//
// Super admins and agency owners/admins manage accounts rather than being a
// practice themselves, so they are never blocked by the BAA gate.
export default function RequireBAA({ children }) {
  const { contextLoading, profile, practice, baaAccepted, accessLevel, isSuperAdmin, user } = useAuth()

  if (contextLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-700 border-t-primary" />
      </div>
    )
  }

  // Super admins and agency-level users bypass the BAA entirely.
  const bypass = isSuperAdmin || ['agency_owner', 'agency_admin'].includes(accessLevel)
  if (bypass) return children

  // Has a practice that hasn't accepted the BAA → force acceptance first.
  if (profile?.practice_id && practice && !baaAccepted) {
    // eslint-disable-next-line no-console
    console.warn('[CaseLift guard] RequireBAA → /baa (practice, not accepted)')
    return <Navigate to="/baa" replace />
  }

  // Signed up with email confirmation but never finished practice provisioning.
  if (!profile?.practice_id && user?.user_metadata?.practice_name) {
    // eslint-disable-next-line no-console
    console.warn('[CaseLift guard] RequireBAA → /baa (no practice_id, has metadata)')
    return <Navigate to="/baa" replace />
  }

  return children
}
