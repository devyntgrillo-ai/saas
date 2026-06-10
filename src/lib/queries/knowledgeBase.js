import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchKnowledgeBase(practiceId) {
  if (!practiceId) return { kb: null, lastUpdated: null }
  const { data, error } = await supabase
    .from('practices')
    .select('knowledge_base, knowledge_base_updated_at')
    .eq('id', practiceId)
    .maybeSingle()
  if (error) throw error
  return {
    kb: data?.knowledge_base ?? null,
    lastUpdated: data?.knowledge_base_updated_at ?? null,
  }
}

export function useKnowledgeBase(practiceId) {
  return useQuery({
    queryKey: queryKeys.knowledgeBase(practiceId),
    queryFn: () => fetchKnowledgeBase(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useSaveKnowledgeBase() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, kb }) => {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('practices')
        .update({ knowledge_base: kb, knowledge_base_updated_at: now })
        .eq('id', practiceId)
      if (error) throw error
      return { practiceId, kb, lastUpdated: now }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.knowledgeBase(data.practiceId), {
        kb: data.kb,
        lastUpdated: data.lastUpdated,
      })
    },
  })
}

export async function fetchPracticeKbItems(practiceId) {
  if (!practiceId) return []
  const { data, error } = await supabase
    .from('practice_knowledge_base')
    .select('*')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export function usePracticeKbItems(practiceId) {
  return useQuery({
    queryKey: queryKeys.practiceKb(practiceId),
    queryFn: () => fetchPracticeKbItems(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useAddPracticeKbItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, category, content }) => {
      const { data, error } = await supabase
        .from('practice_knowledge_base')
        .insert({ practice_id: practiceId, category, content })
        .select()
        .single()
      if (error) throw error
      return { practiceId, item: data }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practiceKb(practiceId) })
    },
  })
}

export function useRemovePracticeKbItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, practiceId }) => {
      const { error } = await supabase.from('practice_knowledge_base').delete().eq('id', id)
      if (error) throw error
      return { id, practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practiceKb(practiceId) })
    },
  })
}

export function useSaveKnowledgeBaseSections() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, patch }) => {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('practices')
        .update({ ...patch, knowledge_base_updated_at: now })
        .eq('id', practiceId)
      if (error) throw error
      return { practiceId, lastUpdated: now }
    },
    onSuccess: ({ practiceId, lastUpdated }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBase(practiceId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.practice(practiceId) })
      queryClient.setQueryData(queryKeys.knowledgeBase(practiceId), (old) => ({
        ...old,
        lastUpdated,
      }))
    },
  })
}

// Approve an auto-learned (pending) fact: mark it approved + active so the AI
// starts using it. Dismissing a pending fact just uses useRemovePracticeKbItem.
export function useApprovePracticeKbItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, practiceId }) => {
      const { error } = await supabase
        .from('practice_knowledge_base')
        .update({ status: 'approved', is_active: true })
        .eq('id', id)
      if (error) throw error
      return { id, practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practiceKb(practiceId) })
    },
  })
}

export function useTogglePracticeKbItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, practiceId, isActive }) => {
      const { error } = await supabase
        .from('practice_knowledge_base')
        .update({ is_active: !isActive })
        .eq('id', id)
      if (error) throw error
      return { id, practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.practiceKb(practiceId) })
    },
  })
}
