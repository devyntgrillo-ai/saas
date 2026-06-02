import { useEffect } from 'react'
import { X } from 'lucide-react'

// Reusable dark-theme modal. Closes on backdrop click and Escape.
export default function Modal({ title, onClose, children, footer, maxWidth = 'max-w-md' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative z-10 w-full ${maxWidth} overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl`}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-surface-700 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-surface-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-surface-700 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
