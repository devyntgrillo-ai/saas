import { useMutation } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { uploadChatAttachment } from '../chat'

export function useSendSupportMessage() {
  return useMutation({
    mutationFn: async ({
      chatId, practiceId, senderType, currentUser, text, threadParentId, file, audioDuration,
    }) => {
      const body = (text || '').trim()
      if ((!body && !file) || !chatId) return null
      let attachment = null
      if (file) attachment = await uploadChatAttachment(chatId, file)
      const isAudio = attachment?.type?.startsWith('audio/')
      const row = {
        chat_id: chatId,
        practice_id: practiceId,
        sender_id: currentUser?.id || null,
        sender_type: senderType,
        sender_name: currentUser?.name || 'User',
        sender_avatar: currentUser?.avatar || null,
        message: body || null,
        thread_parent_id: threadParentId,
        attachment_url: attachment?.url || null,
        attachment_name: attachment?.name || null,
        attachment_type: attachment?.type || null,
        audio_duration: isAudio ? (audioDuration ?? null) : null,
      }
      const { data, error } = await supabase.from('support_messages').insert(row).select('*').single()
      if (error) throw error
      if (isAudio) {
        supabase.functions.invoke('transcribe-chat-audio', { body: { message_id: data.id } }).catch(() => {})
      }
      supabase.functions.invoke('chat-notify', { body: { message_id: data.id } }).catch(() => {})
      return data
    },
  })
}

export function useEditSupportMessage() {
  return useMutation({
    mutationFn: async ({ id, text }) => {
      const { error } = await supabase
        .from('support_messages')
        .update({ message: text.trim(), edited_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      return { id }
    },
  })
}

export function useDeleteSupportMessage() {
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase
        .from('support_messages')
        .update({ deleted_at: new Date().toISOString(), message: null })
        .eq('id', id)
      if (error) throw error
      return { id }
    },
  })
}

export function useAddSupportReaction() {
  return useMutation({
    mutationFn: async ({ messageId, userId, senderType, emoji }) => {
      const { data, error } = await supabase
        .from('support_message_reactions')
        .insert({ message_id: messageId, user_id: userId, sender_type: senderType, emoji })
        .select('*')
        .single()
      if (error) throw error
      return data
    },
  })
}

export function useRemoveSupportReaction() {
  return useMutation({
    mutationFn: async ({ messageId, userId, emoji }) => {
      const { error } = await supabase
        .from('support_message_reactions')
        .delete()
        .match({ message_id: messageId, user_id: userId, emoji })
      if (error) throw error
      return { messageId, userId, emoji }
    },
  })
}

export function useMarkSupportChatRead() {
  return useMutation({
    mutationFn: async ({ chatId, userId, senderType, currentUser }) => {
      const patch = senderType === 'caselift_team' ? { unread_count_admin: 0 } : { unread_count_practice: 0 }
      await supabase.from('support_chats').update(patch).eq('id', chatId)
      const { error } = await supabase.from('support_reads').upsert(
        {
          chat_id: chatId,
          user_id: userId,
          last_read_at: new Date().toISOString(),
          user_name: currentUser?.name || 'User',
          user_avatar: currentUser?.avatar || null,
          sender_type: senderType,
        },
        { onConflict: 'chat_id,user_id' },
      )
      if (error) throw error
      return { chatId }
    },
  })
}

export function useToggleSupportPin() {
  return useMutation({
    mutationFn: async ({ messageId }) => {
      const { error } = await supabase.rpc('toggle_pin', { p_message_id: messageId })
      if (error) throw error
      return { messageId }
    },
  })
}
