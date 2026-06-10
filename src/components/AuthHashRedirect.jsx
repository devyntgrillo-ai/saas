import { useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const SKIP_PATHS = new Set(['/accept-invite', '/reset-password', '/invite'])

/** Where to send auth hash callbacks (invite / recovery) when redirect_to was wrong. */
function targetForAuthHash(pathname, hash, search) {
  if (!hash || SKIP_PATHS.has(pathname) || pathname.startsWith('/invite/')) return null
  const type = new URLSearchParams(hash.replace(/^#/, '')).get('type')
  const qs = search && search.length > 1 ? search : ''
  if (type === 'invite' || type === 'signup') return `/accept-invite${qs}${hash}`
  if (type === 'recovery') return `/reset-password${qs}${hash}`
  return null
}

/**
 * Supabase verify links carry tokens in the URL hash. If redirect_to points at
 * the app root (old invites / allowlist misconfig), users land on "/" with a
 * live session but never see the password screen. Send them to the right page
 * while the hash (and any query params) are still present.
 */
export default function AuthHashRedirect() {
  const { pathname, search, hash } = useLocation()
  const navigate = useNavigate()

  useLayoutEffect(() => {
    const fragment = hash || (typeof window !== 'undefined' ? window.location.hash : '')
    const query = search || (typeof window !== 'undefined' ? window.location.search : '')
    const target = targetForAuthHash(pathname, fragment, query)
    if (target) navigate(target, { replace: true })
  }, [pathname, search, hash, navigate])

  return null
}
