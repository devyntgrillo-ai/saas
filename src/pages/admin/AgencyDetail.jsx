import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, UserCog, Ban, Eye, Check } from 'lucide-react'
import Modal from '../../components/Modal'
import { useAdmin } from '../../context/AdminContext'
import { agencyStatusMeta, PRICING } from '../../lib/admin'
import { statusMeta as subStatusMeta } from '../../lib/billing'
import { timeAgo } from '../../lib/consults'
import { supabase } from '../../lib/supabase'
import { StatCard, Table, Badge, Avatar, money, stop } from '../../components/admin/ui'

export default function AgencyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, refresh, impersonateAgency, impersonatePractice } = useAdmin()
  const [confirmSuspend, setConfirmSuspend] = useState(false)

  const agency = data.agencies.find((a) => String(a.id) === String(id))
  if (!agency) {
    return (
      <div className="card px-6 py-16 text-center">
        <p className="text-sm text-slate-400">Reseller not found.</p>
        <button onClick={() => navigate('/admin/agencies')} className="btn-ghost mt-4">Back to resellers</button>
      </div>
    )
  }

  const practices = data.practices.filter((p) => p.agency_id === agency.id)
  const consultsMonth = practices.reduce((s, p) => s + (p.consults_month || 0), 0)
  const recovered = practices.reduce((s, p) => s + (p.recovered || 0), 0)
  const meta = agencyStatusMeta(agency.status)

  async function suspend() {
    if (!String(agency.id).startsWith('demo-')) {
      try { await supabase.from('agency_accounts').update({ active: agency.status === 'suspended', status: agency.status === 'suspended' ? 'active' : 'suspended' }).eq('id', agency.id) } catch { /* noop */ }
      await refresh()
    }
    setConfirmSuspend(false)
  }

  return (
    <div className="space-y-8">
      <button onClick={() => navigate('/admin/agencies')} className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> All resellers
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={agency.name} color={agency.white_label?.primary_color} />
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-white">{agency.name}</h1>
              <Badge className={meta.classes}>{meta.label}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              {agency.owner_email || 'No owner email'} · Joined {new Date(agency.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => impersonateAgency(agency)} className="btn-ghost text-primary-300">
            <UserCog className="h-4 w-4" /> Impersonate
          </button>
          <button onClick={() => setConfirmSuspend(true)} className="btn-ghost text-rose-300">
            <Ban className="h-4 w-4" /> {agency.status === 'suspended' ? 'Reactivate' : 'Suspend'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="MRR to CaseLift" value={money(agency.mrrToCaseLift)} accent="text-emerald-300" />
        <StatCard label="Their client MRR" value={money(agency.clientMrr)} />
        <StatCard label="Their margin" value={money(agency.margin)} />
        <StatCard label="Active practices" value={practices.filter((p) => p.subscription_status === 'active').length} />
        <StatCard label="Consults (mo)" value={consultsMonth} />
        <StatCard label="Recovered (mo)" value={money(recovered)} accent="text-emerald-300" />
      </div>

      {/* Practices */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Practices</h2>
        <Table
          head={['Practice', 'Doctor', 'Location', 'Subscription', 'Consults/mo', 'Recovered', '']}
          rows={practices.map((p) => [
            <span className="font-medium text-slate-100">{p.name}</span>,
            p.doctor ? `Dr. ${p.doctor}` : '-',
            p.location || '-',
            <Badge className={subStatusMeta(p.subscription_status).classes}>{subStatusMeta(p.subscription_status).label}</Badge>,
            p.consults_month,
            money(p.recovered),
            <div className="flex items-center gap-1.5" onClick={stop}>
              <button onClick={() => navigate(`/admin/practices/${p.id}`)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="View"><Eye className="h-3.5 w-3.5" /></button>
              <button onClick={() => impersonatePractice(p)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-primary-300 transition hover:bg-surface-700">Impersonate</button>
            </div>,
          ])}
          empty="No practices under this reseller yet."
          onRowClick={(i) => navigate(`/admin/practices/${practices[i].id}`)}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WhiteLabelCard wl={agency.white_label} />
        <InternalNotes agency={agency} onSaved={refresh} />
      </div>

      <BillingHistory agency={agency} />

      {confirmSuspend && (
        <Modal title={agency.status === 'suspended' ? 'Reactivate reseller?' : 'Suspend reseller?'} onClose={() => setConfirmSuspend(false)} footer={
          <>
            <button onClick={() => setConfirmSuspend(false)} className="btn-ghost">Cancel</button>
            <button onClick={suspend} className="btn-primary bg-rose-600 hover:bg-rose-500">{agency.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button>
          </>
        }>
          <p className="text-sm text-slate-300">
            {agency.status === 'suspended'
              ? `Reactivate ${agency.name}? Their practices regain full access.`
              : `Suspend ${agency.name}? Their ${practices.length} practice(s) will lose access until reactivated.`}
          </p>
        </Modal>
      )}
    </div>
  )
}

function WhiteLabelCard({ wl }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-white">White label</h2>
      {!wl ? (
        <p className="mt-3 text-sm text-slate-500">Not white-labeled - uses default CaseLift branding.</p>
      ) : (
        <dl className="mt-3 space-y-2.5 text-sm">
          <Row label="Brand name" value={wl.brand_name} />
          <Row label="Primary color" value={
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 rounded ring-1 ring-white/10" style={{ background: wl.primary_color }} />
              <span className="font-mono text-xs">{wl.primary_color}</span>
            </span>
          } />
          <Row label="Custom domain" value={wl.custom_domain || '-'} />
          <Row label="Support email" value={wl.support_email || '-'} />
        </dl>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  )
}

// Auto-saving internal notes (super-admin only).
function InternalNotes({ agency, onSaved }) {
  const [value, setValue] = useState(agency.notes || '')
  const [savedAt, setSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  function onChange(e) {
    setValue(e.target.value)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setSaving(true)
      if (!String(agency.id).startsWith('demo-')) {
        try { await supabase.from('agency_accounts').update({ admin_notes: e.target.value }).eq('id', agency.id) } catch { /* noop */ }
      }
      setSaving(false)
      setSavedAt(new Date())
      onSaved?.()
    }, 900)
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Internal notes</h2>
        <span className="text-xs text-slate-500">
          {saving ? 'Saving…' : savedAt ? <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3 w-3" /> Saved {timeAgo(savedAt.toISOString())}</span> : 'Admin only'}
        </span>
      </div>
      <textarea
        value={value}
        onChange={onChange}
        placeholder="Private notes about this reseller - auto-saves."
        className="input mt-3 min-h-[120px]"
      />
    </div>
  )
}

function BillingHistory({ agency }) {
  // Seed 3 months of charges from the agency's MRR-to-CaseLift.
  const amount = agency.mrrToCaseLift || agency.practiceCount * PRICING.agencyPerLocation
  const months = [0, 1, 2].map((i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    return { month: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), amount, status: 'Paid', invoice: `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}` }
  })
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-white">Billing history</h2>
      <Table
        head={['Month', 'Amount', 'Status', 'Invoice']}
        rows={months.map((m) => [
          m.month,
          money(m.amount),
          <Badge className="bg-emerald-500/15 text-emerald-300">{m.status}</Badge>,
          <span className="font-mono text-xs text-slate-400">{m.invoice}</span>,
        ])}
      />
    </section>
  )
}
