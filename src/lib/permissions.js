// Role-based permission system. usePermissions() returns what the current user
// can do, derived from their access_level (see AuthContext).
import { useAuth } from '../context/AuthContext'

export const ACCESS_LEVELS = {
  super_admin: 6,
  agency_owner: 5,
  agency_admin: 4,
  agency_member: 3,
  practice_owner: 2,
  practice_member: 1,
  practice_viewer: 0,
}

export const ACCESS_LABELS = {
  super_admin: 'Super Admin',
  agency_owner: 'Reseller Owner',
  agency_admin: 'Reseller Admin',
  agency_member: 'Reseller Member',
  practice_owner: 'Practice Owner',
  practice_member: 'Practice Member',
  practice_viewer: 'Practice Viewer',
}

export function levelRank(level) {
  return ACCESS_LEVELS[level] ?? -1
}

export function usePermissions() {
  const { accessLevel, isSuperAdmin } = useAuth()
  const level = accessLevel || null
  const rank = levelRank(level)
  const is = (x) => level === x

  return {
    accessLevel: level,
    rank,
    isSuperAdmin: Boolean(isSuperAdmin),

    // Portal visibility
    canViewAdmin: Boolean(isSuperAdmin),

    // Agency
    canManageAgency: rank >= ACCESS_LEVELS.agency_admin, // add/remove practices, invite
    canManageAgencySettings: rank >= ACCESS_LEVELS.agency_owner,
    canViewAllPractices: rank >= ACCESS_LEVELS.agency_admin,

    // Practice
    canViewSettings: rank >= ACCESS_LEVELS.practice_owner,
    canViewBilling: rank >= ACCESS_LEVELS.practice_owner,
    canManagePracticeSettings: rank >= ACCESS_LEVELS.practice_owner,
    canInvite: is('practice_owner') || rank >= ACCESS_LEVELS.agency_admin || Boolean(isSuperAdmin),
    canEditConsults: rank >= ACCESS_LEVELS.practice_member,
    readOnly: is('practice_viewer'),

    // Roles the current user may grant (at or below their own level).
    grantableRoles: (scope) => {
      const all = Object.keys(ACCESS_LEVELS)
      const ceiling = rank
      let pool = all.filter((k) => ACCESS_LEVELS[k] <= ceiling && k !== 'super_admin')
      if (scope === 'practice') pool = pool.filter((k) => k.startsWith('practice_'))
      if (scope === 'agency') pool = pool.filter((k) => k.startsWith('agency_') || k.startsWith('practice_'))
      return pool
    },
  }
}
