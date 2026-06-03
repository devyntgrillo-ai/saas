import { useEffect, useMemo, useState } from 'react'
import {
  Link2,
  Copy,
  Check,
  Mail,
  MessageSquare,
  Users,
  DollarSign,
  Wallet,
  Clock,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/analytics'
import { formatDate } from '../lib/consults'
import {
  REFERRAL_AMOUNT,
  MIN_PAYOUT,
  referralLink,
  referralStatusMeta,
  EMAIL_SUBJECT,
  emailBody,
} from '../lib/referrals'

const money = (n) => formatMoney(Number(n) || 0)

function StatCard({ label, value, icon: Icon, accent }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-slate-500" />}
      </div>
      <p className={`mt-2 text-2xl font-bold ${accent || 'text-white'}`}>{value}</p>
    </div>
  )
}

export default function ReferralsPanel({ practice }) {
  const { refreshProfile } = useAuth()
  const [code, setCode] = useState(practice?.referral_code || '')
  const [ensuring, setEnsuring] = useState(!practice?.referral_code)
  const [copied, setCopied] = useState('')
  const [referrals, setReferrals] = useState([])
  const [payouts, setPayouts] = useState([])
  const [loading, setLoading] = useState(true)

  // Editable email template.
  const [subject, setSubject] = useState(EMAIL_SUBJECT)
  const [body, setBody] = useState('')

  const link = useMemo(() => referralLink(code), [code])

  // Generate a referral code on first visit (no-op if one already exists).
  useEffect(() => {
    if (practice?.referral_code) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCode(practice.referral_code)
      setEnsuring(false)
      return
    }
    if (!practice?.id) return
    let active = true
    ;(async () => {
      setEnsuring(true)
      const { data } = await supabase.rpc('ensure_referral_code')
      if (!active) return
      if (data) {
        setCode(data)
        refreshProfile()
      }
      setEnsuring(false)
    })()
    return () => {
      active = false
    }
  }, [practice?.id, practice?.referral_code, refreshProfile])

  // Seed the editable email body once we have a link.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (link) setBody(emailBody(link))
  }, [link])

  // Load this practice's referrals + payout ledger.
  useEffect(() => {
    if (!practice?.id) return
    let active = true
    ;(async () => {
      setLoading(true)
      const [r, p] = await Promise.all([
        supabase.rpc('my_referrals'),
        supabase.from('referral_payouts').select('amount, status'),
      ])
      if (!active) return
      setReferrals(r.data || [])
      setPayouts(p.data || [])
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [practice?.id])

  const stats = useMemo(() => {
    const activeCount = referrals.filter((x) => x.subscription_status === 'active').length
    const totalEarned = payouts
      .filter((x) => x.status === 'paid')
      .reduce((s, x) => s + (Number(x.amount) || 0), 0)
    const pending = payouts
      .filter((x) => x.status === 'pending')
      .reduce((s, x) => s + (Number(x.amount) || 0), 0)
    return {
      activeCount,
      monthly: activeCount * REFERRAL_AMOUNT,
      totalEarned,
      pending,
    }
  }, [referrals, payouts])

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(''), 1800)
    } catch {
      /* clipboard unavailable */
    }
  }

  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  const smsHref = `sms:?&body=${encodeURIComponent(
    `Thought you'd want to see this, it's been recovering implant cases for us: ${link}`,
  )}`

  return (
    <div className="relative">
      {/* Page content — blurred and non-interactive behind the Coming Soon overlay. */}
      <div className="space-y-6 select-none blur-[4px] [filter:blur(4px)] pointer-events-none" aria-hidden="true">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-white">Refer a Practice</h2>
        <p className="mt-1 text-sm text-slate-400">
          Earn ${REFERRAL_AMOUNT}/month for every practice you refer that stays active.
        </p>
      </div>

      {/* Section 1 — referral link */}
      <div className="card p-6">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <Link2 className="h-4 w-4 text-primary-300" /> Your referral link
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="flex min-w-0 flex-1 items-center rounded-lg border border-surface-700 bg-surface-800/60 px-3.5 py-2.5">
            {ensuring ? (
              <span className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Generating your link…
              </span>
            ) : (
              <span className="truncate text-sm text-slate-200">{link}</span>
            )}
          </div>
          <button
            onClick={() => copy(link, 'link')}
            disabled={!code}
            className="btn-primary shrink-0"
          >
            {copied === 'link' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>

        {/* Share buttons */}
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={mailto} className="btn-ghost">
            <Mail className="h-4 w-4" /> Email
          </a>
          <a href={smsHref} className="btn-ghost">
            <MessageSquare className="h-4 w-4" /> SMS
          </a>
          <button onClick={() => copy(link, 'share')} disabled={!code} className="btn-ghost">
            {copied === 'share' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === 'share' ? 'Copied' : 'Copy link'}
          </button>
        </div>

        {/* Editable email template */}
        <div className="mt-6 rounded-xl border border-surface-700 bg-surface-800/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Email template
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Edit before sending — the link is already included in the message.
          </p>
          <div className="mt-3 space-y-3">
            <div>
              <label className="label">Subject</label>
              <input
                className="input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Message</label>
              <textarea
                className="input min-h-[120px] resize-y"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <a href={mailto} className="btn-primary">
              <Mail className="h-4 w-4" /> Open in email
            </a>
          </div>
        </div>
      </div>

      {/* Section 2 — earnings */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active referrals" value={stats.activeCount} icon={Users} />
        <StatCard
          label="Monthly earnings"
          value={money(stats.monthly)}
          icon={DollarSign}
          accent="text-emerald-300"
        />
        <StatCard label="Total earned" value={money(stats.totalEarned)} icon={Wallet} />
        <StatCard label="Pending payout" value={money(stats.pending)} icon={Clock} />
      </div>

      {/* Section 3 — referral history */}
      <div className="card overflow-hidden">
        <div className="border-b border-surface-700 px-5 py-3 text-sm font-semibold text-white">
          Referral history
        </div>
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </div>
        ) : referrals.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Users className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-3 text-sm text-slate-400">
              No referrals yet. Share your link to start earning.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Practice name</th>
                  <th className="px-5 py-3">Joined</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Monthly value</th>
                  <th className="px-5 py-3">Your cut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700">
                {referrals.map((r) => {
                  const meta = referralStatusMeta(r.subscription_status)
                  const earning = r.subscription_status === 'active'
                  return (
                    <tr key={r.referred_practice_id} className="text-slate-300">
                      <td className="px-5 py-3.5 font-medium text-slate-100">{r.practice_name}</td>
                      <td className="px-5 py-3.5">{formatDate(r.joined)}</td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.classes}`}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">{money(REFERRAL_AMOUNT)}</td>
                      <td className="px-5 py-3.5">
                        {earning ? (
                          <span className="font-medium text-emerald-300">
                            {money(REFERRAL_AMOUNT)}/mo
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 4 — how it works */}
      <div className="px-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">How it works</p>
        <ol className="mt-3 space-y-2 text-xs text-slate-500">
          <li>1. Share your unique link with another implant practice.</li>
          <li>2. They sign up and start their free trial.</li>
          <li>
            3. You earn ${REFERRAL_AMOUNT}/month for every month they stay active — paid monthly.
          </li>
        </ol>
        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-slate-600">
          Referral earnings are paid via Stripe/ACH on the 1st of each month. Minimum payout $
          {MIN_PAYOUT}. You must have an active CaseLift subscription to receive referral payments.
        </p>
      </div>
      </div>

      {/* Coming Soon overlay — sits above the blurred content; the wrapper above
          is pointer-events-none so nothing behind it is interactive. */}
      <div className="absolute inset-0 z-10 flex items-start justify-center px-6 pt-24">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-surface-700 bg-surface-800/80 shadow-lg ring-1 ring-inset ring-white/5">
            <Sparkles className="h-6 w-6 text-primary-300" />
          </div>
          <h2 className="mt-5 text-2xl font-bold text-white">Coming Soon</h2>
          <p className="mt-2 max-w-sm text-sm text-slate-400">
            Referral Program is launching soon. You&apos;ll be notified when it&apos;s ready.
          </p>
        </div>
      </div>
    </div>
  )
}
