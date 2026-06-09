import { useState } from 'react'
import { Outlet, Link } from 'react-router-dom'
import { Lock, Loader2, CreditCard } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isBillingBlocked } from '../lib/billing'
import { useOpenBillingPortal } from '../lib/queries'

// Route guard: blocks the core app (Consults/Conversations/Performance/KB/
// Training) when the practice's subscription is past_due/unpaid/cancelled/
// expired. Settings is NOT wrapped, so billing stays reachable. Renders within
// the app shell so the sidebar (and thus Settings) remains available.
export default function RequireActiveBilling() {
  const { practice } = useAuth()
  const openPortal = useOpenBillingPortal()
  const [err, setErr] = useState('')

  if (!isBillingBlocked(practice)) return <Outlet />

  async function updatePayment() {
    if (!practice?.id || openPortal.isPending) return
    setErr('')
    try {
      const { url } = await openPortal.mutateAsync({ practiceId: practice.id })
      window.location.href = url
    } catch (e) {
      setErr(e?.message || 'Could not open the billing portal. Please try again.')
    }
  }

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
        {err && (
          <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</p>
        )}
        <button onClick={updatePayment} disabled={openPortal.isPending} className="btn-primary mt-5 w-full">
          {openPortal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          Update Payment Method
        </button>
        <Link to="/settings/billing" className="mt-3 inline-block text-sm text-slate-400 transition hover:text-slate-200">
          Go to billing settings
        </Link>
      </div>
    </div>
  )
}
