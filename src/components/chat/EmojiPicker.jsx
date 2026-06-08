import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import data from '@emoji-mart/data'
import { Picker } from 'emoji-mart'
import { useTheme } from '../../context/ThemeContext'

const QUICK = ['👍', '❤️', '😂', '🎉', '🔥', '✅']

// Floating reaction picker: a quick row of 6 common emoji + a "+" that expands
// the full emoji-mart picker (vanilla core, mounted into a host div — avoids the
// @emoji-mart/react wrapper which caps at React 18). Closes on outside click/Esc.
export default function EmojiPicker({ onSelect, onClose, align = 'left' }) {
  const { isLight } = useTheme()
  const [full, setFull] = useState(false)
  const ref = useRef(null)
  const host = useRef(null)

  useEffect(() => {
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Mount the vanilla emoji-mart Picker element when expanded.
  useEffect(() => {
    if (!full || !host.current) return undefined
    const picker = new Picker({
      data,
      theme: isLight ? 'light' : 'dark',
      previewPosition: 'none',
      skinTonePosition: 'none',
      onEmojiSelect: (e) => { onSelect?.(e.native); onClose?.() },
    })
    const node = host.current
    node.appendChild(picker)
    return () => { try { node.removeChild(picker) } catch { /* noop */ } }
  }, [full, isLight, onSelect, onClose])

  return (
    <div ref={ref} className={`absolute bottom-full z-50 mb-2 ${align === 'right' ? 'right-0' : 'left-0'}`}>
      {full ? (
        <div ref={host} />
      ) : (
        <div className="flex items-center gap-0.5 rounded-full border border-surface-700 bg-surface-900 p-1 shadow-xl">
          {QUICK.map((e) => (
            <button
              key={e}
              onClick={() => { onSelect?.(e); onClose?.() }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition hover:bg-surface-800"
              title={`React ${e}`}
            >
              {e}
            </button>
          ))}
          <button
            onClick={() => setFull(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-surface-800 hover:text-white"
            title="More emoji"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
