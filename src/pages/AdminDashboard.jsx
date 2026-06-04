import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { Building2, Stethoscope, DollarSign, Eye, Loader2, Plus, Check, Sparkles } from 'lucide-react'
import PortalShell, { PortalTab } from '../components/PortalShell'
import Modal from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../lib/permissions'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/analytics'
import { statusMeta as subStatusMeta } from '../lib/billing'
import { useAdminDashboard, useToggleAdminAgency } from '../lib/queries'

const money = (n) => formatMoney(Number(n) || 0)

export default function AdminDashboard() {
  const perms = usePermissions()
  const { viewPractice, contextLoading } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('agencies')
  const [addAgency, setAddAgency] = useState(false)

  const { data: dashboard, isLoading: loading, refetch } = useAdminDashboard(perms.canViewAdmin)
  const toggleAgency = useToggleAdminAgency()
  const data = dashboard || { agencies: [], practices: [], revenue: {} }

  if (!contextLoading && !perms.canViewAdmin) {
    return <Navigate to="/" replace />
  }

  function viewAs(practiceId) {
    viewPractice(practiceId)
    navigate('/')
  }

  const tabs = (
    <>
      <PortalTab active={tab === 'agencies'} onClick={() => setTab('agencies')}>Agencies</PortalTab>
      <PortalTab active={tab === 'practices'} onClick={() => setTab('practices')}>Practices</PortalTab>
      <PortalTab active={tab === 'revenue'} onClick={() => setTab('revenue')}>Revenue</PortalTab>
      <PortalTab active={tab === 'settings'} onClick={() => setTab('settings')}>Settings</PortalTab>
    </>
  )

  return (
    <PortalShell title="ADMIN" badgeClass="bg-rose-500/15 text-rose-300" tabs={tabs}>
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : tab === 'agencies' ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setAddAgency(true)} className="btn-primary"><Plus className="h-4 w-4" /> Add agency</button>
          </div>
          <Table
            head={['Agency', 'Owner', 'Practices', 'MRR', 'White label', 'Status', 'Created', '']}
            rows={data.agencies.map((a) => [
              <span className="font-medium text-slate-100">{a.name}</span>,
              a.owner_email || '-',
              a.practices,
              money(a.mrr),
              a.white_labeled ? <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3.5 w-3.5" /> On</span> : <span className="text-slate-500">-</span>,
              <span className={a.active ? 'text-emerald-300' : 'text-rose-300'}>{a.active ? 'Active' : 'Suspended'}</span>,
              a.created_at ? new Date(a.created_at).toLocaleDateString() : '-',
              <button onClick={() => toggleAgency.mutate({ id: a.id, active: a.active })} disabled={toggleAgency.isPending} className="rounded-lg border border-surface-700 bg-surface-800 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-surface-700">
                {a.active ? 'Suspend' : 'Activate'}
              </button>,
            ])}
            empty="No agencies yet."
            icon={Building2}
          />
        </div>
      ) : tab === 'practices' ? (
        <Table
          head={['Practice', 'Agency', 'Doctor', 'Consults (mo)', 'Subscription', '']}
          rows={data.practices.map((p) => [
            <span className="font-medium text-slate-100">{p.name}</span>,
            p.agency_name || '-',
            p.doctor ? `Dr. ${p.doctor}` : '-',
            p.consults_month,
            <span className={`rounded-full px-2 py-0.5 text-xs ${subStatusMeta(p.subscription_status).classes}`}>{subStatusMeta(p.subscription_status).label}</span>,
            <button onClick={() => viewAs(p.id)} className="inline-flex items-center gap-1 rounded-lg border border-surface-700 bg-surface-800 px-2.5 py-1 text-xs font-medium text-primary-300 transition hover:bg-surface-700">
              <Eye className="h-3.5 w-3.5" /> View
            </button>,
          ])}
          empty="No practices yet."
          icon={Stethoscope}
        />
      ) : tab === 'revenue' ? (
        <RevenueTab revenue={data.revenue} />
      ) : (
        <SettingsTab />
      )}

      {addAgency && <AddAgencyModal onClose={() => setAddAgency(false)} onSaved={() => { setAddAgency(false); refetch() }} />}
    </PortalShell>
  )
}

function AddAgencyModal({ onClose, onSaved }) {
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [fee, setFee] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim()) return
    setBusy(true); setError('')
    const owner = ownerEmail.trim()
      ? (await supabase.from('users').select('id').eq('email', ownerEmail.trim().toLowerCase()).maybeSingle()).data?.id || null
      : null
    const { error: ae } = await supabase
      .from('agency_accounts')
      .insert({ name: name.trim(), owner_user_id: owner, monthly_fee: Number(fee) || 0, active: true })
    setBusy(false)
    if (ae) { setError(ae.message); return }
    onSaved()
  }

  return (
    <Modal title="Add agency" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={save} disabled={busy || !name.trim()} className="btn-primary">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create agency</button>
      </>
    }>
      <div className="space-y-4">
        <div><label className="label">Agency name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northwest Implant Group" /></div>
        <div><label className="label">Owner email</label><input className="input" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@agency.com" /></div>
        <div><label className="label">Monthly fee (USD)</label><input className="input" type="number" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="2997" /></div>
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  )
}

function Table({ head, rows, empty, icon: Icon }) {
  if (!rows.length) {
    return (
      <div className="card px-6 py-16 text-center">
        {Icon && <Icon className="mx-auto h-9 w-9 text-slate-600" />}
        <p className="mt-3 text-sm text-slate-400">{empty}</p>
      </div>
    )
  }
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-700 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {head.map((h, i) => <th key={i} className="px-5 py-3">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-700">
            {rows.map((cells, r) => (
              <tr key={r} className="text-slate-300">
                {cells.map((c, i) => <td key={i} className="px-5 py-3.5 align-middle">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RevenueTab({ revenue }) {
  const r = revenue || {}
  const cards = [
    { label: 'Total MRR', value: money(r.total_mrr), icon: DollarSign },
    { label: 'New signups this month', value: r.new_signups_month ?? 0, icon: Stethoscope },
    { label: 'Churn this month', value: r.churn_month ?? 0, icon: Building2 },
  ]
  const byAgency = Array.isArray(r.by_agency) ? r.by_agency : []
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">{c.label}</p>
              <c.icon className="h-4 w-4 text-slate-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-white">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-white">MRR by agency</h2>
        <ul className="mt-3 divide-y divide-surface-700">
          {byAgency.length === 0 ? (
            <li className="py-4 text-sm text-slate-500">No agency revenue yet.</li>
          ) : byAgency.map((b) => (
            <li key={b.name} className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-slate-300">{b.name}</span>
              <span className="font-semibold text-slate-100">{money(b.mrr)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SettingsTab() {
  return (
    <div className="card p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-800 text-primary-300">
        <Sparkles className="h-6 w-6" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-200">Platform settings</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
        Global CaseLift configuration lives here - default plans, network-wide AI tuning, and platform
        announcements. More controls coming soon.
      </p>
    </div>
  )
}
