import { Navigate, useParams } from 'react-router-dom'

// Public entry point for referral links: /r/[code]. Persists the code so it
// survives the trip through signup (and any email-confirmation round-trip),
// then forwards to the signup page with ?ref=[code].
export const REF_STORAGE_KEY = 'hope_ref_code'

export default function ReferralRedirect() {
  const { code } = useParams()
  if (code) {
    try {
      localStorage.setItem(REF_STORAGE_KEY, code)
    } catch {
      /* storage unavailable - the query param still carries the code */
    }
  }
  return <Navigate to={`/signup?ref=${encodeURIComponent(code || '')}`} replace />
}
