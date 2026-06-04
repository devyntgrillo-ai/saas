const RETURN_KEY = 'ciq_baa_return'

export function stashBaaReturnPath(pathname, search = '') {
  if (!pathname || pathname === '/baa') return
  try {
    sessionStorage.setItem(RETURN_KEY, `${pathname}${search || ''}`)
  } catch {
    /* private mode / quota */
  }
}

export function takeBaaReturnPath() {
  try {
    const path = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    return path && path !== '/baa' ? path : null
  } catch {
    return null
  }
}

export function baaReturnFromLocation(state) {
  const from = state?.from
  if (!from) return null
  if (typeof from === 'string') return from !== '/baa' ? from : null
  const path = `${from.pathname || '/'}${from.search || ''}${from.hash || ''}`
  return path !== '/baa' ? path : null
}
