// Signed-URL access for PRIVATE storage buckets (PHI-bearing attachments).
//
// conversation-attachments and chat-attachments hold patient files and are
// served from PRIVATE buckets — every read goes through a short-lived signed
// URL instead of a public CDN link. We store the bare object PATH in the DB
// (e.g. `<conversationId>/169...-ab.png`) and mint signed URLs on demand here.
//
// Backward compatible: old rows stored a full public URL, and inbound MMS rows
// can store an external (e.g. Twilio-hosted) URL. resolveAttachmentUrl handles
// all three: bucket path → sign, legacy bucket public/sign URL → extract path
// then sign, external http(s) URL → return as-is.
import { supabase } from './supabase'

// True when `stored` points at an object inside our private `bucket` (a bare
// path, or a legacy public/sign URL for that bucket). External URLs return false.
export function isStorageRef(bucket, stored) {
  if (!stored) return false
  if (stored.includes(`/storage/v1/object/public/${bucket}/`)) return true
  if (stored.includes(`/storage/v1/object/sign/${bucket}/`)) return true
  if (/^https?:\/\//i.test(stored)) return false // external (e.g. Twilio media)
  return true // bare object path
}

// Reduce any stored value to the bare object path within `bucket`.
export function storagePath(bucket, stored) {
  if (!stored) return ''
  const pub = `/storage/v1/object/public/${bucket}/`
  const i = stored.indexOf(pub)
  if (i !== -1) return decodeURIComponent(stored.slice(i + pub.length))
  const sign = `/storage/v1/object/sign/${bucket}/`
  const j = stored.indexOf(sign)
  if (j !== -1) return decodeURIComponent(stored.slice(j + sign.length).split('?')[0])
  return stored.replace(/^\/+/, '')
}

const DEFAULT_TTL = 60 * 60 // seconds
const cache = new Map() // `${bucket}:${path}` -> { url, exp }

// Resolve a stored attachment value to a usable URL. External URLs pass through
// untouched; bucket objects get a fresh (cached) signed URL. Returns '' on
// failure so callers can fall back gracefully.
export async function resolveAttachmentUrl(bucket, stored, { ttl = DEFAULT_TTL } = {}) {
  if (!stored) return ''
  if (!isStorageRef(bucket, stored)) return stored
  const path = storagePath(bucket, stored)
  if (!path) return ''
  const key = `${bucket}:${path}`
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.exp > now + 30_000) return hit.url
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl)
  if (error || !data?.signedUrl) return ''
  cache.set(key, { url: data.signedUrl, exp: now + ttl * 1000 })
  return data.signedUrl
}
