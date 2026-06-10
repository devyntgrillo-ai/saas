import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { auditAccessDenied } from '../lib/audit'

// Shown when a lower-privileged user reaches content their role can't see.
// Logs the blocked attempt to audit_logs on mount (HIPAA: record attempted
// access, not just successful access). Pure UI otherwise, no PHI is rendered.
export default function AccessRestricted({
  resource = 'restricted',
  resourceId = null,
  reason = 'insufficient_role',
  title = 'Access Restricted',
  message = "Your role doesn't have access to this. Ask a practice admin if you need it.",
  showHomeLink = true,
}) {
  useEffect(() => {
    const path = typeof window !== 'undefined' ? window.location.pathname : null
    auditAccessDenied(resource, resourceId, { reason, path })
  }, [resource, resourceId, reason])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="card max-w-md p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
          <Lock className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">{message}</p>
        {showHomeLink && (
          <Link to="/" className="btn-primary mt-5 inline-flex w-full justify-center">
            Back to dashboard
          </Link>
        )}
      </div>
    </div>
  )
}
