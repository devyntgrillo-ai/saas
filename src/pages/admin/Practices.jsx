import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Stethoscope, Search, Eye, UserCog, Archive, RotateCcw, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useAdmin } from '../../context/AdminContext'
import { supabase } from '../../lib/supabase'
import { smsStatusMeta } from '../../lib/admin'
import { statusMeta as subStatusMeta } from '../../lib/billing'
import { Table, Badge, money, stop } from '../../components/admin/ui'

const archivedName = (p) => [p.doctor_first, p.doctor_last].filter(Boolean).join(' ')

export default function Practices() {
  const { user } = useAuth()
  const { data, impersonatePractice, refresh } = useAdmin()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [agencyId, setAgencyId] = useState('all')
  const [sub, setSub] = useState('all')
  const [busyId, setBusyId] = useState(null)

  // Archived (soft-deleted) subaccounts - lazy-loaded the first time revealed.
  const [showArchived, setShowArchived] = useState(false)
  const [archived, setArchived] = useState(null) // null = not loaded yet
  const [loadingArchived, setLoadingArchived] = useState(false)

  const rows = useMemo(() => {
    let list = [...data.practices]
    const query = q.trim().toLowerCase()
    if (query)
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.doctor || '').toLowerCase().includes(query) ||
          (p.location || '').toLowerCase().includes(query),
      )
    if (agencyId !== 'all') list = list.filter((p) => (agencyId === 'direct' ? !p.agency_id : p.agency_id === agencyId))
    if (sub !== 'all') list = list.filter((p) => p.subscription_status === sub)
    return list
  }, [data.practices, q, agencyId, sub])

  function lastRecording(days) {
    if (days == null) return <span className="text-slate-500">-</span>
    const cls = days >= 7 ? 'text-rose-300' : 'text-slate-300'
    return <span className={cls}>{days === 0 ? 'Today' : `${days}d ago`}</span>
  }

  async function loadArchived() {
    setLoadingArchived(true)
    const { data: arch } = await supabase
      .from('practices')
      .select('id, name, doctor_first, doctor_last, agency_id, archived_at, agency:agency_accounts(name)')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
    setArchived(arch || [])
    setLoadingArchived(false)
  }

  async function toggleArchived() {
    const next = !showArchived
    setShowArchived(next)
    if (next && archived === null) await loadArchived()
  }

  async function archive(p) {
    if (!confirm(`Archive ${p.name}? It will be hidden from all list views but can be restored later.`)) return
    setBusyId(p.id)
    const { error } = await supabase
      .from('practices')
      .update({ archived_at: new Date().toISOString(), archived_by: user?.id ?? null })
      .eq('id', p.id)
    setBusyId(null)
    if (error) return alert(error.message)
    await refresh()
    if (archived !== null) await loadArchived()
  }

  async function restore(p) {
    setBusyId(p.id)
    const { error } = await supabase.from('practices').update({ archived_at: null, archived_by: null }).eq('id', p.id)
    setBusyId(null)
    if (error) return alert(error.message)
    await Promise.all([refresh(), loadArchived()])
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Subaccounts</h1>
        <p className="text-sm text-slate-500">{data.practices.length} active across all resellers</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search practice, doctor, location..." className="input pl-9" />
        </div>
        <select value={agencyId} onChange={(e) => setAgencyId(e.target.value)} className="input w-auto">
          <option value="all">All resellers</option>
          <option value="direct">Direct (no reseller)</option>
          {data.agencies.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select value={sub} onChange={(e) => setSub(e.target.value)} className="input w-auto">
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="trialing">Trial</option>
          <option value="past_due">Past due</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <Table
        head={['Practice', 'Doctor', 'Reseller', 'Location', 'Subscription', 'Consults/mo', 'Recovered', 'Last recording', 'SMS', '']}
        rows={rows.map((p) => {
          const sms = smsStatusMeta(p.sms_status)
          const busy = busyId === p.id
          return [
            <span className="font-medium text-slate-100">{p.name}</span>,
            p.doctor ? `Dr. ${p.doctor}` : '-',
            p.agency_name || <span className="text-slate-500">Direct</span>,
            p.location || '-',
            <span className="flex flex-col">
              <Badge className={subStatusMeta(p.subscription_status).classes}>{subStatusMeta(p.subscription_status).label}</Badge>
              <span className="mt-0.5 text-xs text-slate-500">{p.days_on_platform}d on platform</span>
            </span>,
            p.consults_month,
            money(p.recovered),
            lastRecording(p.last_recording_days),
            <span className={sms.classes}>{sms.label}</span>,
            <div className="flex items-center gap-1.5" onClick={stop}>
              <button onClick={() => navigate(`/admin/practices/${p.id}`)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="View"><Eye className="h-3.5 w-3.5" /></button>
              <button onClick={() => impersonatePractice(p)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-primary-300 transition hover:bg-surface-700" title="Impersonate"><UserCog className="h-3.5 w-3.5" /></button>
              <button onClick={() => archive(p)} disabled={busy} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-rose-300 transition hover:bg-surface-700 disabled:opacity-40" title="Archive subaccount">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
              </button>
            </div>,
          ]
        })}
        empty="No practices match your filters."
        icon={Stethoscope}
        onRowClick={(i) => navigate(`/admin/practices/${rows[i].id}`)}
      />

      {/* Archived subaccounts - hidden from the list above; restorable. */}
      <div>
        <button onClick={toggleArchived} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition hover:text-slate-200">
          {showArchived ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Archive className="h-4 w-4" /> Archived subaccounts{archived !== null ? ` (${archived.length})` : ''}
        </button>

        {showArchived && (
          <div className="mt-3">
            {loadingArchived ? (
              <div className="card flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
            ) : (
              <Table
                head={['Practice', 'Doctor', 'Reseller', 'Archived', '']}
                rows={(archived || []).map((p) => {
                  const busy = busyId === p.id
                  return [
                    <span className="font-medium text-slate-300">{p.name}</span>,
                    archivedName(p) ? `Dr. ${archivedName(p)}` : '-',
                    p.agency?.name || <span className="text-slate-500">Direct</span>,
                    p.archived_at ? new Date(p.archived_at).toLocaleDateString() : '-',
                    <div className="flex items-center gap-1.5" onClick={stop}>
                      <button onClick={() => restore(p)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-emerald-300 transition hover:bg-surface-700 disabled:opacity-40" title="Restore subaccount">
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Restore
                      </button>
                    </div>,
                  ]
                })}
                empty="No archived subaccounts."
                icon={Archive}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
