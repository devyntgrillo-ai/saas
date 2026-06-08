import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Module-level cache so a given URL is only unfurled once per session.
const cache = new Map()

export default function LinkPreview({ url }) {
  const [data, setData] = useState(() => cache.get(url) ?? null)

  useEffect(() => {
    if (cache.has(url)) return undefined // already resolved → initial state has it
    let on = true
    supabase.functions
      .invoke('link-preview', { body: { url } })
      .then(({ data: d }) => {
        const v = d?.ok ? d : null
        cache.set(url, v)
        if (on) setData(v)
      })
      .catch(() => { cache.set(url, null) })
    return () => { on = false }
  }, [url])

  if (!data) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 flex max-w-md gap-3 overflow-hidden rounded-lg border border-surface-700 border-l-2 border-l-primary/50 bg-surface-800/60 p-2.5 transition hover:bg-surface-800"
    >
      {data.image && (
        <img src={data.image} alt="" className="h-14 w-14 shrink-0 rounded object-cover" loading="lazy" />
      )}
      <div className="min-w-0">
        {data.siteName && <p className="truncate text-[11px] text-slate-500">{data.siteName}</p>}
        <p className="truncate text-sm font-medium text-slate-100">{data.title}</p>
        {data.description && <p className="line-clamp-2 text-xs text-slate-400">{data.description}</p>}
      </div>
    </a>
  )
}
