import { useEffect, useState } from 'react'
import { isStorageRef, resolveAttachmentUrl } from '../lib/storage'

// Resolve a stored attachment value (bare path / legacy public URL / external
// URL) to a usable href for a PRIVATE bucket. External URLs render immediately;
// bucket objects resolve to a short-lived signed URL after mount.
export function useAttachmentUrl(bucket, stored) {
  const [signed, setSigned] = useState('')
  useEffect(() => {
    if (!stored || !isStorageRef(bucket, stored)) return undefined
    let on = true
    resolveAttachmentUrl(bucket, stored).then((u) => { if (on) setSigned(u) })
    return () => { on = false }
  }, [bucket, stored])
  if (!stored) return ''
  // Storage objects use the (async) signed URL; external URLs pass through.
  return isStorageRef(bucket, stored) ? signed : stored
}
