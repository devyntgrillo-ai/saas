import { Outlet, Link } from 'react-router-dom'
import { Lock, CreditCard } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isBillingBlocked } from '../lib/billing'

// Route guard: blocks the core app (Consults/Conversations/Performance/KB/
// Training) when the practice's subscription is past_due/unpaid/cancelled/
// expired. Settings is NOT wrapped, so billing stays reachable. Renders within
// the app shell so the sidebar (and thus Settings) remains available.
export default function RequireActiveBilling() {
  const { practice } = useAuth()

  if (!isBillingBlocked(practice)) return <Outlet />

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="card max-w-md p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
          <Lock className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-white">Your subscription is paused</h1>
        <p className="mt-2 text-sm text-slate-400">
          Update your payment method to restore access to CaseLift.
        </p>
        <Link to="/settings/billing" className="btn-primary mt-5 inline-flex w-full justify-center">
          <CreditCard className="h-4 w-4" /> Update payment method
        </Link>
      </div>
    </div>
  )
}
