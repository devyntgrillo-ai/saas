import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

export async function fetchConversationsList(practiceId) {
  if (!practiceId) return []

  let { data, error } = await supabase
    .from('conversations')
    .select('*, consult:consults(id, starred, archived)')
    .eq('practice_id', practiceId)
    .order('last_message_at', { ascending: false, nullsFirst: false })

  if (error) {
    const res = await supabase
      .from('conversations')
      .select('*')
      .eq('practice_id', practiceId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
    data = res.data
    if (res.error) throw res.error
  }

  return data || []
}

export async function fetchConversationThread(practiceId, conversationId) {
  if (!practiceId || !conversationId) {
    return { messages: [], callRecordings: {} }
  }

  const [{ data: messages, error: me }, { data: calls }] = await Promise.all([
    supabase
      .from('conversation_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
    supabase
      .from('call_logs')
      .select('id, recording_url, duration_seconds, disposition, transcript_deidentified, transcript_status, transcript_error')
      .eq('conversation_id', conversationId),
  ])

  if (me) throw me

  const callRecordings = {}
  for (const r of calls || []) callRecordings[r.id] = r

  return { messages: messages || [], callRecordings }
}

export async function fetchConversationContext(practiceId, conversation) {
  if (!practiceId || !conversation) {
    return { consult: null, consultMsgs: [] }
  }

  let row = null
  if (conversation.consult_id) {
    const { data } = await supabase.from('consults').select('*').eq('id', conversation.consult_id).maybeSingle()
    row = data || null
  }

  if (!row) {
    const ors = []
    if (conversation.patient_phone) ors.push(`patient_phone.eq.${conversation.patient_phone}`)
    if (conversation.patient_email) ors.push(`patient_email.eq.${conversation.patient_email}`)
    if (ors.length) {
      const { data } = await supabase
        .from('consults')
        .select('*')
        .eq('practice_id', practiceId)
        .or(ors.join(','))
        .order('created_at', { ascending: false })
        .limit(1)
      row = data?.[0] || null
    }
  }

  let consultMsgs = []
  if (row) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('status, channel, scheduled_for, sent_at, send_day')
      .eq('consult_id', row.id)
    consultMsgs = msgs || []
  }

  return { consult: row, consultMsgs }
}

export async function insertConvMessage(row) {
  let res = await supabase.from('conversation_messages').insert(row).select().single()
  if (res.error && row.meta && /meta|column/i.test(res.error.message || '')) {
    const { meta, ...rest } = row // eslint-disable-line no-unused-vars
    res = await supabase.from('conversation_messages').insert(rest).select().single()
  }
  if (res.error) throw res.error
  return res.data
}

export function useConversationsList(practiceId) {
  return useQuery({
    queryKey: queryKeys.conversations(practiceId),
    queryFn: () => fetchConversationsList(practiceId),
    enabled: Boolean(practiceId),
  })
}

export function useConversationThread(practiceId, conversationId) {
  return useQuery({
    queryKey: queryKeys.conversationThread(practiceId, conversationId),
    queryFn: () => fetchConversationThread(practiceId, conversationId),
    enabled: Boolean(practiceId && conversationId),
  })
}

export function useConversationContext(practiceId, conversation) {
  const conversationId = conversation?.id
  return useQuery({
    queryKey: queryKeys.conversationContext(practiceId, conversationId),
    queryFn: () => fetchConversationContext(practiceId, conversation),
    enabled: Boolean(practiceId && conversationId),
  })
}

export function useMarkConversationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, conversationId }) => {
      const { error } = await supabase
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('id', conversationId)
      if (error) throw error
      return { practiceId, conversationId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
    },
  })
}

export function useToggleConversationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, conversationId, unreadCount }) => {
      const { error } = await supabase
        .from('conversations')
        .update({ unread_count: unreadCount })
        .eq('id', conversationId)
      if (error) throw error
      return { practiceId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
    },
  })
}

export function useUpdateConsultFlags() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ consultId, patch, practiceId }) => {
      const { error } = await supabase.from('consults').update(patch).eq('id', consultId)
      if (error) throw error
      return { practiceId, consultId }
    },
    onSuccess: ({ practiceId }) => {
      if (practiceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
      }
    },
  })
}

export function useBumpConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ practiceId, conversationId, lastMessageAt, preview }) => {
      const patch = { last_message_at: lastMessageAt, ...(preview ? { last_message_preview: preview } : {}) }
      const { error } = await supabase.from('conversations').update(patch).eq('id', conversationId)
      if (error) throw error
      return { practiceId, conversationId }
    },
    onSuccess: ({ practiceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
    },
  })
}

export function useSendConversationMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload) => {
      const { data, error } = await supabase
        .from('conversation_messages')
        .insert(payload.row)
        .select()
        .single()
      if (error) throw error
      if (payload.bump) {
        await supabase
          .from('conversations')
          .update({ last_message_at: payload.bump.at, ...(payload.bump.preview ? { last_message_preview: payload.bump.preview } : {}) })
          .eq('id', payload.conversationId)
      }
      return { ...payload, message: data }
    },
    onSuccess: (_data, variables) => {
      const { practiceId, conversationId } = variables
      queryClient.invalidateQueries({ queryKey: queryKeys.conversationThread(practiceId, conversationId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
    },
  })
}

export function useInsertConvMessageMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables) => {
      const data = await insertConvMessage(variables.row)
      if (variables.bump) {
        await supabase
          .from('conversations')
          .update({
            last_message_at: variables.bump.at,
            ...(variables.bump.preview ? { last_message_preview: variables.bump.preview } : {}),
          })
          .eq('id', variables.conversationId)
      }
      return { ...variables, message: data }
    },
    onSuccess: (_data, variables) => {
      const { practiceId, conversationId } = variables
      queryClient.invalidateQueries({ queryKey: queryKeys.conversationThread(practiceId, conversationId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
    },
  })
}

export function invalidateConversationQueries(queryClient, practiceId, conversationId) {
  queryClient.invalidateQueries({ queryKey: queryKeys.conversations(practiceId) })
  if (conversationId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.conversationThread(practiceId, conversationId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.conversationContext(practiceId, conversationId) })
  }
}

function consultPatientPatch(convPatch) {
  const name = [convPatch.patient_first, convPatch.patient_last].filter(Boolean).join(' ').trim() || null
  return {
    patient_first: convPatch.patient_first,
    patient_last: convPatch.patient_last,
    patient_phone: convPatch.patient_phone,
    patient_email: convPatch.patient_email,
    patient_name: name,
  }
}

export function patchConversationInList(queryClient, practiceId, conversationId, patch) {
  queryClient.setQueryData(queryKeys.conversations(practiceId), (old) =>
    (old || []).map((c) => (c.id === conversationId ? { ...c, ...patch } : c)),
  )
}

export function patchConversationContextConsult(queryClient, practiceId, conversationId, consultPatch) {
  queryClient.setQueryData(queryKeys.conversationContext(practiceId, conversationId), (old) =>
    old?.consult ? { ...old, consult: { ...old.consult, ...consultPatch } } : old,
  )
}

export function useUpdateConversationPatient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ conversationId, consultId, patch, practiceId }) => {
      const { error } = await supabase.from('conversations').update(patch).eq('id', conversationId)
      if (error) throw error

      if (consultId) {
        const consultPatch = consultPatientPatch(patch)
        const { error: consultError } = await supabase.from('consults').update(consultPatch).eq('id', consultId)
        if (consultError) throw consultError
      }

      return { practiceId, conversationId, consultId, patch }
    },
    onSuccess: ({ practiceId, conversationId, consultId, patch }) => {
      patchConversationInList(queryClient, practiceId, conversationId, patch)
      if (consultId) {
        patchConversationContextConsult(
          queryClient,
          practiceId,
          conversationId,
          consultPatientPatch(patch),
        )
      }
    },
  })
}
