import { useEffect, useRef, useState } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { timeLabel } from './chatUtil'

// Header search: searches all messages + thread replies in the current channel.
export default function ChatSearch({ chatId, onJump }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  async function run(value) {
    setQ(value)
    if (!value.trim() || !chatId) { setResults([]); return }
    setLoading(true)
    const { data } = await supabase
      .from('support_messages')
      .select('id, sender_name, message, created_at, thread_parent_id')
      .eq('chat_id', chatId)
      .is('deleted_at', null)
      .ilike('message', `%${value.trim()}%`)
      .order('created_at', { ascending: false })
      .limit(30)
    setResults(data || [])
    setLoading(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-surface-800 hover:text-white"
        title="Search messages"
      >
        <Search className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-xl">
          <div className="flex items-center gap-2 border-b border-surface-700 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-500" />
            <input
              autoFocus
              value={q}
              onChange={(e) => run(e.target.value)}
              placeholder="Search messages…"
              className="w-full bg-transparent text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
            />
            <button onClick={() => { setOpen(false); setQ(''); setResults([]) }} className="text-slate-500 transition hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {loading && <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-500" /></div>}
            {!loading && q.trim() && results.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-slate-500">No matches.</p>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => { onJump?.(r.id); setOpen(false) }}
                className="block w-full rounded-lg px-3 py-2 text-left transition hover:bg-surface-800"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-slate-200">
                    {r.sender_name}
                    {r.thread_parent_id && <span className="ml-1 text-[10px] text-primary-300">· thread</span>}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">{timeLabel(r.created_at)}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 text-xs text-slate-400">{r.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
