import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Stethoscope, Search, Eye, UserCog } from 'lucide-react'
import { useAdmin } from '../../context/AdminContext'
import { smsStatusMeta } from '../../lib/admin'
import { statusMeta as subStatusMeta } from '../../lib/billing'
import { Table, Badge, money, stop } from '../../components/admin/ui'

export default function Practices() {
  const { data, impersonatePractice } = useAdmin()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [agencyId, setAgencyId] = useState('all')
  const [sub, setSub] = useState('all')

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Practices</h1>
        <p className="text-sm text-slate-500">{data.practices.length} across all resellers</p>
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
            </div>,
          ]
        })}
        empty="No practices match your filters."
        icon={Stethoscope}
        onRowClick={(i) => navigate(`/admin/practices/${rows[i].id}`)}
      />
    </div>
  )
}
