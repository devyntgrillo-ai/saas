import { useState } from 'react'
import { Pin, ChevronDown, X } from 'lucide-react'

// Collapsible bar listing the channel's pinned messages; click to jump.
export default function PinnedBar({ pins = [], onJump, onUnpin }) {
  const [open, setOpen] = useState(false)
  if (!pins.length) return null
  return (
    <div className="border-b border-surface-700 bg-amber-500/[0.04]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-5 py-1.5 text-xs font-medium text-amber-300/90">
        <Pin className="h-3.5 w-3.5" />
        {pins.length} pinned {pins.length > 1 ? 'messages' : 'message'}
        <ChevronDown className={`ml-auto h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto px-3 pb-2">
          {pins.map((p) => (
            <div key={p.id} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-800">
              <Pin className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/70" />
              <button onClick={() => { onJump?.(p.id); setOpen(false) }} className="min-w-0 flex-1 text-left">
                <p className="truncate text-xs font-medium text-slate-300">{p.sender_name}</p>
                <p className="line-clamp-2 text-xs text-slate-400">
                  {p.message || (p.attachment_name ? `📎 ${p.attachment_name}` : '(no text)')}
                </p>
              </button>
              {onUnpin && (
                <button onClick={() => onUnpin(p.id)} className="text-slate-500 opacity-0 transition hover:text-rose-400 group-hover:opacity-100" title="Unpin">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
