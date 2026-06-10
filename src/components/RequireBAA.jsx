import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { stashBaaReturnPath } from '../lib/baaReturn'
import AuthLoadingScreen from './AuthLoadingScreen'

// Gates the authenticated app behind BAA acceptance. A practice that hasn't
// accepted the Business Associate Agreement cannot reach any PHI-bearing screen.
// Users not yet linked to a practice are allowed through (they'll see the
// "finish setup" prompts); the BAA is stored on the practice record.
//
// Super admins and agency owners/admins manage accounts rather than being a
// practice themselves, so they are never blocked by the BAA gate.
export default function RequireBAA({ children }) {
  const {
    contextLoading,
    profileResolved,
    profile,
    practice,
    baaAccepted,
    accessLevel,
    isSuperAdmin,
    isAgencyUser,
  } = useAuth()
  const location = useLocation()

  if (contextLoading || !profileResolved) {
    return <AuthLoadingScreen />
  }

  // Super admins and agency-level users bypass the BAA entirely.
  const bypass = isSuperAdmin || ['agency_owner', 'agency_admin'].includes(accessLevel)
  if (bypass) return children

  // Linked to a practice: wait for the practice row, then enforce BAA.
  if (profile?.practice_id) {
    if (!practice) {
      return <AuthLoadingScreen />
    }
    if (!baaAccepted) {
      stashBaaReturnPath(location.pathname, location.search)
      return <Navigate to="/baa" replace state={{ from: location }} />
    }
    return children
  }

  // Agency-level users manage accounts rather than owning a practice of their
  // own, so a missing practice_id is expected — let them through.
  if (isAgencyUser) return children

  // Anything reaching here is a signed-in user with NO workspace: either a signup
  // still provisioning (carries practice_name metadata) or an INVITED user whose
  // account never got linked to a practice. Never drop them into the app — every
  // practice-scoped page renders broken (the "account not linked" error). Send
  // them to the clean setup / "workspace not ready" screen at /baa instead.
  stashBaaReturnPath(location.pathname, location.search)
  return <Navigate to="/baa" replace state={{ from: location }} />
}
