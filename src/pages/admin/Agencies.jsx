import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Plus, Search, Eye, Loader2, Ban, RotateCcw, Pencil } from 'lucide-react'
import Modal from '../../components/Modal'
import { useAdmin } from '../../context/AdminContext'
import { agencyStatusMeta } from '../../lib/admin'
import { supabase } from '../../lib/supabase'
import { StatCard, Table, Badge, Avatar, money, stop } from '../../components/admin/ui'
import { COMMISSION_DEFAULT } from '../../lib/resellerSaas'

const STATUS_FILTERS = ['all', 'active', 'trial', 'suspended']
const SORTS = [
  { key: 'commission', label: 'Commission owed' },
  { key: 'name', label: 'Name' },
  { key: 'joined', label: 'Joined' },
  { key: 'activity', label: 'Last activity' },
]

export default function Agencies() {
  const { data, loading, refresh, impersonateAgency } = useAdmin()
  const navigate = useNavigate()
  const agencies = data?.agencies || []
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('commission')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const rows = useMemo(() => {
    let list = [...agencies]
    const query = q.trim().toLowerCase()
    if (query) {
      list = list.filter(
        (a) => a.name.toLowerCase().includes(query) || (a.owner_email || '').toLowerCase().includes(query),
      )
    }
    if (status !== 'all') {
      list = list.filter((a) =>
        status === 'trial' ? a.status === 'trial' || a.status === 'trialing' : a.status === status,
      )
    }
    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'joined') return new Date(b.created_at) - new Date(a.created_at)
      if (sort === 'activity') return new Date(b.last_activity || 0) - new Date(a.last_activity || 0)
      return (b.commissionOwed || 0) - (a.commissionOwed || 0)
    })
    return list
  }, [agencies, q, status, sort])

  const totals = useMemo(
    () => ({
      resellers: agencies.length,
      active: agencies.reduce((s, a) => s + (a.active || 0), 0),
      commission: agencies.reduce((s, a) => s + (a.commissionOwed || 0), 0),
    }),
    [agencies],
  )

  async function toggleSuspend(a) {
    setBusyId(a.id)
    const next = a.suspended ? { status: 'active', active: true } : { status: 'suspended', active: false }
    await supabase.from('agency_accounts').update(next).eq('id', a.id)
    setBusyId(null)
    await refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Resellers</h1>
          <p className="text-sm text-slate-500">
            {agencies.length} total · {money(totals.commission)}/mo commission owed
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="btn-primary">
          <Plus className="h-4 w-4" /> Add reseller
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Agencies" value={totals.resellers} />
        <StatCard label="Active referred practices" value={totals.active} accent="text-primary-300" />
        <StatCard label="Monthly commission owed" value={money(totals.commission)} accent="text-emerald-300" sub="active × rate" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by reseller or owner email..."
            className="input pl-9"
          />
        </div>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-2 text-sm font-medium capitalize transition ${status === s ? 'bg-primary/10 text-primary-300' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input w-auto">
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      ) : (
        <Table
          head={['Agency', 'Owner', 'Active referred', 'Commission rate', 'Commission / mo', 'Status', '']}
          rows={rows.map((a) => [
            <div className="flex items-center gap-2.5">
              <Avatar name={a.name} color={a.white_label?.primary_color} />
              <span className="font-medium text-slate-100">{a.name}</span>
            </div>,
            a.owner_email || '—',
            <span className="text-primary-300">{a.active || 0}</span>,
            `${money(a.commission_rate)}/mo`,
            <span className="font-medium text-emerald-300">{money(a.commissionOwed || 0)}</span>,
            <Badge className={agencyStatusMeta(a.status).classes}>{agencyStatusMeta(a.status).label}</Badge>,
            <div className="flex items-center gap-1.5" onClick={stop}>
              <button
                onClick={() => navigate(`/admin/agencies/${a.id}`)}
                className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700"
                title="View referred practices"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => impersonateAgency(a)}
                className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-primary-300 transition hover:bg-surface-700"
              >
                Impersonate
              </button>
              <button
                onClick={() => setEditing(a)}
                className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700"
                title="Edit commission rate"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => toggleSuspend(a)}
                disabled={busyId === a.id}
                className={`rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs transition hover:bg-surface-700 disabled:opacity-40 ${a.suspended ? 'text-emerald-300' : 'text-rose-300'}`}
                title={a.suspended ? 'Reactivate' : 'Suspend'}
              >
                {a.suspended ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
              </button>
            </div>,
          ])}
          empty="No resellers match your filters."
          icon={Building2}
          onRowClick={(i) => navigate(`/admin/agencies/${rows[i].id}`)}
        />
      )}

      {adding && (
        <AddAgencyModal
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await refresh()
          }}
        />
      )}
      {editing && (
        <EditRateModal
          agency={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

function AddAgencyModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '',
    firstName: '',
    lastName: '',
    email: '',
    commission: String(COMMISSION_DEFAULT),
    invite: true,
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save() {
    if (!form.name.trim()) return
    setBusy(true)
    setError('')
    try {
      const owner = form.email.trim()
        ? (await supabase.from('users').select('id').eq('email', form.email.trim().toLowerCase()).maybeSingle()).data?.id || null
        : null
      const commission = Number(form.commission)
      const payload = {
        name: form.name.trim(),
        owner_user_id: owner,
        owner_email: form.email.trim().toLowerCase() || null,
        owner_name: [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(' ') || null,
        commission_rate: Number.isFinite(commission) && commission >= 0 ? commission : COMMISSION_DEFAULT,
        active: true,
        status: 'active',
        admin_notes: form.notes.trim() || null,
      }
      let { error: ae } = await supabase.from('agency_accounts').insert(payload)
      if (ae && /column .* does not exist/i.test(ae.message)) {
        ae = (
          await supabase.from('agency_accounts').insert({
            name: payload.name,
            owner_user_id: owner,
            active: true,
          })
        ).error
      }
      if (ae) throw ae
      if (form.invite && form.email.trim()) {
        try {
          await supabase.functions.invoke('invite-practice-user', {
            body: { email: form.email.trim().toLowerCase(), role: 'agency_owner', agency_name: form.name.trim() },
          })
        } catch {
          /* noop */
        }
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Could not create reseller.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add reseller"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={save} disabled={busy || !form.name.trim()} className="btn-primary">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create reseller
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Reseller name</label>
          <input className="input" value={form.name} onChange={set('name')} placeholder="Northwest Implant Group" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Owner first name</label>
            <input className="input" value={form.firstName} onChange={set('firstName')} placeholder="Marcus" />
          </div>
          <div>
            <label className="label">Owner last name</label>
            <input className="input" value={form.lastName} onChange={set('lastName')} placeholder="Webb" />
          </div>
        </div>
        <div>
          <label className="label">Owner email</label>
          <input className="input" value={form.email} onChange={set('email')} placeholder="owner@agency.com" />
        </div>
        <div>
          <label className="label">Commission per referred practice (USD/mo)</label>
          <input className="input" type="number" min={0} value={form.commission} onChange={set('commission')} />
          <p className="mt-1.5 text-xs text-slate-500">Flat monthly commission per active referred practice. Default {money(COMMISSION_DEFAULT)}.</p>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={form.invite}
            onChange={set('invite')}
            className="h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary focus:ring-primary/40"
          />
          Send invite email to owner
        </label>
        <div>
          <label className="label">Internal notes</label>
          <textarea className="input min-h-[72px]" value={form.notes} onChange={set('notes')} placeholder="Only visible to super admin" />
        </div>
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  )
}

function EditRateModal({ agency, onClose, onSaved }) {
  const [rate, setRate] = useState(String(agency.commission_rate ?? COMMISSION_DEFAULT))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const value = Number(rate)
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a valid rate.')
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await supabase
      .from('agency_accounts')
      .update({ commission_rate: value })
      .eq('id', agency.id)
    if (err) {
      setError(err.message)
      setBusy(false)
      return
    }
    onSaved()
  }

  return (
    <Modal
      title={`Commission rate — ${agency.name}`}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save rate
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-400">
          Flat monthly commission CaseLift pays this agency per active referred practice. Default is {money(COMMISSION_DEFAULT)}.
        </p>
        <div>
          <label className="label">Commission rate (USD/active practice/mo)</label>
          <input className="input" type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  )
}
