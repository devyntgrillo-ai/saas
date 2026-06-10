/** Central query keys, always include practiceId (and conversationId for threads). */
export const queryKeys = {
  admin: {
    all: ['admin'],
    data: () => ['admin', 'data'],
    billing: () => ['admin', 'billing'],
    referrals: () => ['admin', 'referrals'],
    training: () => ['admin', 'training'],
    agenciesSaas: () => ['admin', 'agencies-saas'],
    attribution: () => ['admin', 'attribution'],
    practiceConsults: (practiceId) => ['admin', 'practice-consults', practiceId],
    practicePms: (practiceId) => ['admin', 'practice-pms', practiceId],
  },
  agency: {
    overview: (agencyId) => ['agency', agencyId, 'overview'],
    practices: (agencyId) => ['agency', agencyId, 'practices'],
    analytics: (agencyId) => ['agency', agencyId, 'analytics'],
    team: (agencyId) => ['agency', agencyId, 'team'],
    saasClients: (agencyId) => ['agency', agencyId, 'saas-clients'],
    kbPractices: (agencyId) => ['agency', agencyId, 'kb-practices'],
  },
  audit: (range) => ['audit', range],
  invitation: (token) => ['invitation', token],
  practice: (practiceId) => ['practice', practiceId],
  dashboard: (practiceId) => ['practice', practiceId, 'dashboard'],
  networkComparison: (practiceId) => ['practice', practiceId, 'network-comparison'],
  analytics: (practiceId) => ['practice', practiceId, 'analytics'],
  consultsDay: (practiceId, date) => ['practice', practiceId, 'consults-day', date],
  upcomingConsults: (practiceId) => ['practice', practiceId, 'upcoming-consults'],
  unlinkedConsults: (practiceId) => ['practice', practiceId, 'unlinked-consults'],
  processingConsults: (practiceId) => ['practice', practiceId, 'processing-consults'],
  recentConsults: (practiceId) => ['practice', practiceId, 'recent-consults'],
  consultArchive: (practiceId, search, page) => ['practice', practiceId, 'consult-archive', search, page],
  consult: (consultId) => ['consult', consultId],
  consultMessages: (consultId) => ['consult', consultId, 'messages'],
  consultConversation: (consultId) => ['consult', consultId, 'conversation'],
  consultAppointment: (consultId) => ['consult', consultId, 'appointment'],
  consultAttribution: (consultId) => ['consult', consultId, 'attribution'],
  sequences: (practiceId) => ['practice', practiceId, 'sequences'],
  sequenceActiveCount: (practiceId) => ['practice', practiceId, 'sequence-active-count'],
  conversations: (practiceId) => ['practice', practiceId, 'conversations'],
  conversationThread: (practiceId, conversationId) => [
    'practice',
    practiceId,
    'conversation-thread',
    conversationId,
  ],
  conversationContext: (practiceId, conversationId) => [
    'practice',
    practiceId,
    'conversation-context',
    conversationId,
  ],
  notifications: (practiceId) => ['practice', practiceId, 'notifications'],
  globalSearch: (practiceId, term) => ['practice', practiceId, 'search', term],
  knowledgeBase: (practiceId) => ['practice', practiceId, 'knowledge-base'],
  practiceKb: (practiceId) => ['practice', practiceId, 'practice-kb'],
  practiceTeam: (practiceId) => ['practice', practiceId, 'team'],
  pmsToday: (practiceId) => ['practice', practiceId, 'pms-today'],
  recordingRate: (practiceId, weeks = 4) => ['practice', practiceId, 'recording-rate', weeks],
  aiLearning: (practiceId, limit = 30) => ['practice', practiceId, 'ai-learning', limit],
  aiTip: (practiceId) => ['practice', practiceId, 'ai-tip'],
  training: {
    modules: () => ['training', 'modules'],
    groups: () => ['training', 'groups'],
    progress: (userId) => ['training', 'progress', userId],
    recommendation: (practiceId) => ['training', 'recommendation', practiceId],
  },
  powerDialer: {
    queue: (practiceId) => ['practice', practiceId, 'power-dialer-queue'],
    recentCalls: (practiceId) => ['practice', practiceId, 'recent-calls'],
  },
  reactivation: (practiceId) => ['practice', practiceId, 'reactivation-campaigns'],
  reactivationAudience: (practiceId, filters) => ['practice', practiceId, 'reactivation-audience', filters],
  referrals: (practiceId) => ['practice', practiceId, 'referrals'],
  pmsAppointmentCount: (practiceId) => ['practice', practiceId, 'pms-appointment-count'],
  plaudLastSync: (practiceId) => ['practice', practiceId, 'plaud-last-sync'],
  messagingOptOuts: (practiceId) => ['practice', practiceId, 'messaging-opt-outs'],
}

/** Invalidate all queries scoped to a practice (e.g. after impersonation switch). */
export function practiceQueryFilter(practiceId) {
  return {
    predicate: (query) => {
      const key = query.queryKey
      return key[0] === 'practice' && key[1] === practiceId
    },
  }
}
