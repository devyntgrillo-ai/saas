import { useAuth } from '@/lib/auth-context';
import { ACCESS_LEVELS, levelRank } from '@/lib/access-levels';

export { ACCESS_LEVELS, levelRank, canBypassBaaGate } from '@/lib/access-levels';

export function usePermissions() {
  const { accessLevel } = useAuth();
  const level = accessLevel || null;
  const rank = levelRank(level);

  return {
    accessLevel: level,
    rank,
    canViewPHI: rank >= ACCESS_LEVELS.practice_member,
    canViewConsultDetail: rank >= ACCESS_LEVELS.practice_member,
    canViewConversations: rank >= ACCESS_LEVELS.practice_member,
    canEditConsults: rank >= ACCESS_LEVELS.practice_member,
    canRecord: rank >= ACCESS_LEVELS.practice_member,
    readOnly: level === 'practice_viewer',
    canViewSettings: rank >= ACCESS_LEVELS.practice_owner,
  };
}
