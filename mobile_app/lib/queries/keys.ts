export const queryKeys = {
  dashboard: (practiceId: string | null) => ['practice', practiceId, 'dashboard'] as const,
  processingConsults: (practiceId: string | null) => ['practice', practiceId, 'processing-consults'] as const,
  pmsToday: (practiceId: string | null) => ['practice', practiceId, 'pms-today'] as const,
  consultArchive: (practiceId: string | null, search: string, page: number) =>
    ['practice', practiceId, 'consult-archive', search, page] as const,
  consult: (consultId: string | null) => ['consult', consultId] as const,
  conversations: (practiceId: string | null) => ['practice', practiceId, 'conversations'] as const,
  conversationThread: (practiceId: string | null, conversationId: string | null) =>
    ['practice', practiceId, 'conversation-thread', conversationId] as const,
  conversation: (practiceId: string | null, conversationId: string | null) =>
    ['practice', practiceId, 'conversation', conversationId] as const,
  training: {
    modules: () => ['training', 'modules'] as const,
    progress: (userId: string) => ['training', 'progress', userId] as const,
  },
  supportChat: (chatId: string | null) => ['support-chat', chatId] as const,
};
