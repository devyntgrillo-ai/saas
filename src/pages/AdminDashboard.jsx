import { useCallback, useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { Building2, Stethoscope, DollarSign, Eye, Loader2, Plus, Check, Sparkles } from 'lucide-react'
import PortalShell, { PortalTab } from '../components/PortalShell'
import Modal from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../lib/permissions'
import { supabase } from '../lib/supabase'
import { formatMoney } from '../lib/analytics'
import { statusMeta as subStatusMeta } from '../lib/billing'

const money = (n) => formatMoney(Number(n) || 0)

// ---- Direct-table fallbacks (used when the admin_* RPCs aren't installed) ---

// Map a raw agency_accounts row to the shape the table expects, tolerating
// either column naming (active|status, owner_user_id|owner_email, etc.).
function shapeAgency(r, practiceCount, emailById) {
  return {
    id: r.id,
    name: r.name,
    owner_email: r.owner_email || emailById[r.owner_user_id] || null,
    practices: practiceCount,
    mrr: Number(r.monthly_fee) || 0,
    white_labeled: r.white_label_enabled ?? r.white_labeled ?? r.is_white_labeled ?? false,
    active: r.active ?? (r.status ? r.status === 'active' : true),
    created_at: r.created_at,
  }
}

async function loadAgenciesDirect() {
  const { data: rows, error } = await supabase
    .from('agency_accounts')
    .select('*')
    .order('created_at', { ascending: true })
  if (error || !rows?.length) return []

  const { data: pr } = await supabase.from('practices').select('id, agency_id')
  const counts = {}
  ;(pr || []).forEach((x) => { if (x.agency_id) counts[x.agency_id] = (counts[x.agency_id] || 0) + 1 })

  const ownerIds = [...new Set(rows.map((r) => r.owner_user_id).filter(Boolean))]
  const emailById = {}
  if (ownerIds.length) {
    const { data: us } = await supabase.from('users').select('id, email').in('id', ownerIds)
    ;(us || []).forEach((u) => { emailById[u.id] = u.email })
  }
  return rows.map((r) => shapeAgency(r, counts[r.id] || 0, emailById))
}

async function loadPracticesDirect() {
  const since = new Date(); since.setDate(since.getDate() - 30)
  // select('*') so a column that only exists in some environments (doctor_name,
  // subscription_status, agency_id) never errors the whole query.
  const { data: rows, error } = await supabase
    .from('practices')
    .select('*, agency:agency_accounts(name)')
    .order('name')
  if (error || !rows?.length) return []

  const { data: consults } = await supabase
    .from('consults')
    .select('practice_id, created_at')
    .gte('created_at', since.toISOString())
  const byPractice = {}
  ;(consults || []).forEach((c) => { byPractice[c.practice_id] = (byPractice[c.practice_id] || 0) + 1 })

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    agency_name: p.agency?.name || null,
    doctor:
      p.doctor_name ||
      [p.doctor_first, p.doctor_last].filter(Boolean).join(' ') ||
      null,
    consults_month: byPractice[p.id] || 0,
    subscription_status: p.subscription_status,
  }))
}

function deriveRevenue(agencies) {
  const total = agencies.reduce((s, a) => s + (Number(a.mrr) || 0), 0)
  return {
    total_mrr: total,
    new_signups_month: 0,
    churn_month: 0,
    by_agency: agencies.map((a) => ({ name: a.name, mrr: Number(a.mrr) || 0 })),
  }
}

export default function AdminDashboard() {
  const perms = usePermissions()
  const { viewPractice, contextLoading } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('agencies')
  const [data, setData] = useState({ agencies: [], practices: [], revenue: null })
  const [loading, setLoading] = useState(true)
  const [addAgency, setAddAgency] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [a, p, rev] = await Promise.all([
      supabase.rpc('admin_agencies'),
      supabase.rpc('admin_practices'),
      supabase.rpc('admin_revenue'),
    ])

    // The admin_* RPCs may not exist yet (or return empty). Fall back to
    // reading the base tables directly and deriving the display fields so the
    // page works regardless of whether the RPCs are installed.
    let agencies = a.error ? [] : a.data || []
    let practices = p.error ? [] : p.data || []
    let revenue = rev.error ? null : rev.data
    if (a.error || agencies.length === 0) agencies = await loadAgenciesDirect()
    if (p.error || practices.length === 0) practices = await loadPracticesDirect()
    if (!revenue) revenue = deriveRevenue(agencies)

    setData({ agencies, practices, revenue: revenue || {} })
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!perms.canViewAdmin) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [perms.canViewAdmin, load])

  async function toggleAgency(id, active) {
    await supabase.from('agency_accounts').update({ active: !active }).eq('id', id)
    load()
  }

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
              <button onClick={() => toggleAgency(a.id, a.active)} className="rounded-lg border border-surface-700 bg-surface-800 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-surface-700">
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

      {addAgency && <AddAgencyModal onClose={() => setAddAgency(false)} onSaved={() => { setAddAgency(false); load() }} />}
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
