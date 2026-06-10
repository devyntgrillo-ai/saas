import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, PhoneCall, MessagesSquare, Loader2, CornerDownLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useGlobalSearch } from '../lib/queries'

// Cmd/Ctrl+K command palette searching consults + conversations.
export default function GlobalSearch() {
  const { practiceId } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [debouncedTerm, setDebouncedTerm] = useState('')
  const { data: results = { consults: [], conversations: [] }, isFetching: loading } = useGlobalSearch(
    practiceId,
    debouncedTerm,
    open,
  )
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)

  // Flatten for keyboard navigation.
  const flat = [...results.consults, ...results.conversations]

  // Global Cmd+K / Ctrl+K listener.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 20)
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTerm('')
      setDebouncedTerm('')
      setActiveIdx(0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setDebouncedTerm(term.trim())
      setActiveIdx(0)
    }, 220)
    return () => clearTimeout(t)
  }, [term, open])

  function go(item) {
    setOpen(false)
    navigate(item.to)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && flat[activeIdx]) {
      e.preventDefault()
      go(flat[activeIdx])
    }
  }

  const Group = ({ label, icon: Icon, items, offset }) =>
    items.length > 0 && (
      <div className="py-1.5">
        <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {items.map((item, i) => {
          const idx = offset + i
          const active = idx === activeIdx
          return (
            <button
              key={item.id}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => go(item)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${
                active ? 'bg-surface-800' : 'hover:bg-surface-800/60'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-200">{item.title}</span>
                {item.subtitle && <span className="block truncate text-xs text-slate-500">{item.subtitle}</span>}
              </span>
              {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
            </button>
          )
        })}
      </div>
    )

  return (
    <>
      {/* Trigger - compact on mobile, full on desktop */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-400 transition hover:border-surface-600 hover:text-slate-200"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-2 hidden rounded border border-surface-600 bg-surface-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-surface-700 px-4">
              <Search className="h-4 w-4 shrink-0 text-slate-500" />
              <input
                ref={inputRef}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search consults and conversations…"
                className="w-full bg-transparent py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
              />
              {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-500" />}
            </div>

            <div className="max-h-[24rem] overflow-y-auto">
              {term.trim() && !loading && flat.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  No results for “{term.trim()}”
                </div>
              ) : !term.trim() ? (
                <div className="px-4 py-10 text-center text-xs text-slate-500">
                  Search by patient name, phone, objection, or status.
                </div>
              ) : (
                <>
                  <Group label="Consults" icon={PhoneCall} items={results.consults} offset={0} />
                  <Group
                    label="Inbox"
                    icon={MessagesSquare}
                    items={results.conversations}
                    offset={results.consults.length}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
