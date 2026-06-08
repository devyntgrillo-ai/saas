// Live unread count for the practice's support channel, for the sidebar badge.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useChatUnread(practiceId) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!practiceId) return undefined
    let active = true
    async function load() {
      const { data } = await supabase
        .from('support_chats')
        .select('unread_count_practice')
        .eq('practice_id', practiceId)
        .maybeSingle()
      if (active) setCount(data?.unread_count_practice || 0)
    }
    load()
    const ch = supabase
      .channel(`chat-unread:${practiceId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_chats', filter: `practice_id=eq.${practiceId}` }, (payload) => {
        setCount(payload.new?.unread_count_practice || 0)
      })
      .subscribe()
    // Reset on practice switch / unmount (in cleanup, not synchronously in the body).
    return () => { active = false; supabase.removeChannel(ch); setCount(0) }
  }, [practiceId])

  return count
}
