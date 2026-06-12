export const ACCESS_LEVELS = {
  super_admin: 6,
  agency_owner: 5,
  agency_admin: 4,
  agency_member: 3,
  practice_owner: 2,
  practice_member: 1,
  practice_viewer: 0,
} as const;

export function levelRank(level: string | null | undefined) {
  return ACCESS_LEVELS[level as keyof typeof ACCESS_LEVELS] ?? -1;
}

/** Matches web RequireBAA — reseller/admin roles manage accounts, not practice PHI. */
export function canBypassBaaGate(accessLevel: string | null | undefined) {
  return (
    accessLevel === 'super_admin' ||
    accessLevel === 'agency_owner' ||
    accessLevel === 'agency_admin'
  );
}
