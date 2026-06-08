// Slack-style support chat hook. Shared by the practice chat view and the admin
// master inbox. Manages messages (incl. thread replies), reactions and typing
// indicators for a single channel, with live Supabase Realtime subscriptions.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const PAGE = 50
const TYPING_TTL_MS = 5000 // a typing row older than this is ignored / cleared

export function useSupportChat({ chatId, practiceId, senderType, currentUser }) {
  const [messages, setMessages] = useState([]) // all messages (top-level + replies)
  const [reactions, setReactions] = useState([]) // flat reaction rows for loaded messages
  const [typing, setTyping] = useState([]) // active typing rows (excluding me)
  const [presence, setPresence] = useState([]) // users currently in the channel
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)

  const me = currentUser?.id
  const typingTimerRef = useRef(null)
  const lastTypingSentRef = useRef(0)

  // ── Initial load ────────────────────────────────────────────────────────────
  const fetchMessages = useCallback(async () => {
    if (!chatId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (!error && data) {
      const ordered = [...data].reverse()
      setMessages(ordered)
      setHasMore(data.length === PAGE)
      const ids = ordered.map((m) => m.id)
      if (ids.length) {
        const { data: rx } = await supabase.from('support_message_reactions').select('*').in('message_id', ids)
        setReactions(rx || [])
      } else {
        setReactions([])
      }
    }
    setLoading(false)
  }, [chatId])

  const loadEarlier = useCallback(async () => {
    if (!chatId || !messages.length) return
    const oldest = messages[0].created_at
    const { data } = await supabase
      .from('support_messages')
      .select('*')
      .eq('chat_id', chatId)
      .lt('created_at', oldest)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (data?.length) {
      const ordered = [...data].reverse()
      setMessages((prev) => [...ordered, ...prev])
      setHasMore(data.length === PAGE)
      const ids = ordered.map((m) => m.id)
      const { data: rx } = await supabase.from('support_message_reactions').select('*').in('message_id', ids)
      if (rx?.length) setReactions((prev) => [...prev, ...rx])
    } else {
      setHasMore(false)
    }
  }, [chatId, messages])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMessages()
  }, [fetchMessages])

  // ── Realtime subscriptions ───────────────────────────────────────────────────
  useEffect(() => {
    if (!chatId) return undefined
    const channel = supabase
      .channel(`support:${chatId}`, { config: { presence: { key: me || 'anon' } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages', filter: `chat_id=eq.${chatId}` }, (payload) => {
        setMessages((prev) => {
          if (payload.eventType === 'INSERT') {
            if (prev.some((m) => m.id === payload.new.id)) return prev
            return [...prev, payload.new]
          }
          if (payload.eventType === 'UPDATE') {
            return prev.map((m) => (m.id === payload.new.id ? payload.new : m))
          }
          if (payload.eventType === 'DELETE') {
            return prev.filter((m) => m.id !== payload.old.id)
          }
          return prev
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_message_reactions' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setReactions((prev) => (prev.some((r) => r.id === payload.new.id) ? prev : [...prev, payload.new]))
        } else if (payload.eventType === 'DELETE') {
          setReactions((prev) => prev.filter((r) => r.id !== payload.old.id))
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_typing_indicators', filter: `chat_id=eq.${chatId}` }, (payload) => {
        const row = payload.new || payload.old
        if (!row) return
        setTyping((prev) => {
          const without = prev.filter((t) => t.id !== row.id)
          if (payload.eventType === 'DELETE') return without
          return [...without, payload.new]
        })
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const seen = new Set()
        const users = []
        for (const entry of Object.values(state).flat()) {
          if (entry?.user_id && !seen.has(entry.user_id)) { seen.add(entry.user_id); users.push(entry) }
        }
        setPresence(users)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && me) {
          channel.track({ user_id: me, name: currentUser?.name || 'User', avatar: currentUser?.avatar || null, sender_type: senderType })
        }
      })
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, me, senderType])

  // Expire stale typing rows every couple seconds (covers missed DELETE events).
  useEffect(() => {
    const iv = setInterval(() => {
      const cutoff = Date.now() - TYPING_TTL_MS
      setTyping((prev) => prev.filter((t) => new Date(t.last_typed_at).getTime() > cutoff))
    }, 2000)
    return () => clearInterval(iv)
  }, [])

  // ── Actions ──────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text, threadParentId = null) => {
      const body = (text || '').trim()
      if (!body || !chatId) return null
      const row = {
        chat_id: chatId,
        practice_id: practiceId,
        sender_id: me || null,
        sender_type: senderType,
        sender_name: currentUser?.name || 'User',
        sender_avatar: currentUser?.avatar || null,
        message: body,
        thread_parent_id: threadParentId,
      }
      const { data, error } = await supabase.from('support_messages').insert(row).select('*').single()
      if (error) throw error
      // Optimistically show the message immediately (don't wait on the realtime
      // echo, which the INSERT handler de-dupes by id).
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
      // Fire notifications + Slack ping (non-blocking). Typing auto-expires and
      // the composer calls stopTyping on send.
      supabase.functions.invoke('chat-notify', { body: { message_id: data.id } }).catch(() => {})
      return data
    },
    [chatId, practiceId, senderType, me, currentUser],
  )

  const editMessage = useCallback(async (id, text) => {
    const { error } = await supabase
      .from('support_messages')
      .update({ message: text.trim(), edited_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }, [])

  const deleteMessage = useCallback(async (id) => {
    const { error } = await supabase
      .from('support_messages')
      .update({ deleted_at: new Date().toISOString(), message: null })
      .eq('id', id)
    if (error) throw error
  }, [])

  const addReaction = useCallback(
    async (messageId, emoji) => {
      if (!me) return
      await supabase
        .from('support_message_reactions')
        .insert({ message_id: messageId, user_id: me, sender_type: senderType, emoji })
        .select('*')
        .single()
        .then(({ data }) => data && setReactions((prev) => (prev.some((r) => r.id === data.id) ? prev : [...prev, data])))
        .catch(() => {}) // unique violation = already reacted
    },
    [me, senderType],
  )

  const removeReaction = useCallback(
    async (messageId, emoji) => {
      if (!me) return
      await supabase
        .from('support_message_reactions')
        .delete()
        .match({ message_id: messageId, user_id: me, emoji })
      setReactions((prev) => prev.filter((r) => !(r.message_id === messageId && r.user_id === me && r.emoji === emoji)))
    },
    [me],
  )

  const toggleReaction = useCallback(
    (messageId, emoji) => {
      const mine = reactions.some((r) => r.message_id === messageId && r.user_id === me && r.emoji === emoji)
      return mine ? removeReaction(messageId, emoji) : addReaction(messageId, emoji)
    },
    [reactions, me, addReaction, removeReaction],
  )

  const stopTyping = useCallback(
    (threadParentId = null) => {
      if (!chatId || !me) return
      const scope = threadParentId ? String(threadParentId) : 'main'
      lastTypingSentRef.current = 0
      supabase.from('support_typing_indicators').delete().match({ chat_id: chatId, user_id: me, scope }).then(() => {})
    },
    [chatId, me],
  )

  const startTyping = useCallback(
    (threadParentId = null) => {
      if (!chatId || !me) return
      const now = Date.now()
      const scope = threadParentId ? String(threadParentId) : 'main'
      // Throttle network writes to ~once per 2s.
      if (now - lastTypingSentRef.current > 2000) {
        lastTypingSentRef.current = now
        supabase
          .from('support_typing_indicators')
          .upsert(
            { chat_id: chatId, user_id: me, sender_type: senderType, sender_name: currentUser?.name || 'User', scope, last_typed_at: new Date().toISOString() },
            { onConflict: 'chat_id,user_id,scope' },
          )
          .then(() => {})
      }
      // Clear after 3s of inactivity.
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => stopTyping(threadParentId), 3000)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatId, me, senderType, currentUser],
  )

  const markAsRead = useCallback(async () => {
    if (!chatId) return
    const patch = senderType === 'caselift_team' ? { unread_count_admin: 0 } : { unread_count_practice: 0 }
    await supabase.from('support_chats').update(patch).eq('id', chatId)
  }, [chatId, senderType])

  // Active typing users (not me), de-duplicated by user+scope. Staleness is
  // pruned by the TTL interval above, so we avoid an impure Date.now() in render.
  const typingUsers = typing
    .filter((t) => t.user_id !== me)
    .filter((t, i, arr) => arr.findIndex((x) => x.user_id === t.user_id && x.scope === t.scope) === i)

  return {
    messages,
    reactions,
    typingUsers,
    presence,
    loading,
    hasMore,
    fetchMessages,
    loadEarlier,
    sendMessage,
    editMessage,
    deleteMessage,
    addReaction,
    removeReaction,
    toggleReaction,
    startTyping,
    stopTyping,
    markAsRead,
  }
}

// Group a flat reaction list into [{ emoji, count, mine, names[] }] for a message.
export function groupReactions(reactionRows, messageId, myId) {
  const forMsg = reactionRows.filter((r) => r.message_id === messageId)
  const map = new Map()
  for (const r of forMsg) {
    const g = map.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false, userIds: [] }
    g.count += 1
    g.userIds.push(r.user_id)
    if (r.user_id === myId) g.mine = true
    map.set(r.emoji, g)
  }
  return [...map.values()]
}
