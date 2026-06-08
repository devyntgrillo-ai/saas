// Chat attachment upload → public `chat-attachments` bucket.
import { supabase } from './supabase'

export async function uploadChatAttachment(chatId, file) {
  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase()
  const rand = Math.random().toString(36).slice(2, 8)
  const path = `${chatId}/${Date.now()}-${rand}.${ext}`
  const { error } = await supabase.storage
    .from('chat-attachments')
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('chat-attachments').getPublicUrl(path)
  return { url: data.publicUrl, name: file.name || 'file', type: file.type || '' }
}
