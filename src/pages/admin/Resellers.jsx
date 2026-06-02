import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Eye, Loader2, Ban, RotateCcw, Pencil, Send } from 'lucide-react'
import Modal from '../../components/Modal'
import { supabase } from '../../lib/supabase'
import { StatCard, Table, Badge, Avatar, money, stop } from '../../components/admin/ui'
import { WHOLESALE_PRICE, isActiveSubaccount } from '../../lib/resellerSaas'

// Hope AI super-admin view of the reseller SaaS economy: what each reseller
// charges, how many active subaccounts they run, what they collect vs. what we
// bill them, and their margin. Queries agency_accounts + practices directly so
// the numbers reflect the live reseller_client_price / $297 wholesale model.
export default function Resellers() {
  const navigate = useNavigate()
  const [agencies, setAgencies] = useState([])
  const [practices, setPractices] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // agency being rate-edited
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    const [agRes, prRes] = await Promise.all([
      supabase.from('agency_accounts').select('id, name, company_name, brand_name, owner_email, status, active, primary_color, reseller_client_price, reseller_wholesale_price'),
      supabase.from('practices').select('id, agency_id, subscription_status').not('agency_id', 'is', null),
    ])
    setAgencies(agRes.data || [])
    setPractices(prRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      if (active) await load()
    })()
    return () => {
      active = false
    }
  }, [load])

  const rows = useMemo(() => {
    const activeByAgency = new Map()
    for (const p of practices) {
      if (isActiveSubaccount(p.subscription_status)) {
        activeByAgency.set(p.agency_id, (activeByAgency.get(p.agency_id) || 0) + 1)
      }
    }
    return agencies
      .map((a) => {
        const active = activeByAgency.get(a.id) || 0
        const price = Number(a.reseller_client_price) || 0
        const wholesale = Number(a.reseller_wholesale_price) || WHOLESALE_PRICE
        const suspended = a.status === 'suspended' || a.active === false
        return {
          ...a,
          name: a.company_name || a.brand_name || a.name,
          active,
          price,
          wholesale,
          gross: active * price,
          ourRevenue: active * wholesale,
          margin: active * (price - wholesale),
          suspended,
          configured: a.reseller_client_price != null,
        }
      })
      .sort((x, y) => y.ourRevenue - x.ourRevenue)
  }, [agencies, practices])

  const totals = useMemo(() => {
    const active = rows.reduce((s, r) => s + r.active, 0)
    return {
      resellers: rows.length,
      active,
      ourMrr: rows.reduce((s, r) => s + r.ourRevenue, 0),
      gross: rows.reduce((s, r) => s + r.gross, 0),
      margin: rows.reduce((s, r) => s + r.margin, 0),
    }
  }, [rows])

  async function toggleSuspend(a) {
    setBusyId(a.id)
    const next = a.suspended ? { status: 'active', active: true } : { status: 'suspended', active: false }
    await supabase.from('agency_accounts').update(next).eq('id', a.id)
    setBusyId(null)
    await load()
  }

  async function billNow(a) {
    setBusyId(a.id)
    try {
      await supabase.functions.invoke('bill-resellers', { body: { agency_id: a.id } })
    } catch {
      /* surfaced via reload */
    }
    setBusyId(null)
    await load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Reseller SaaS</h1>
        <p className="text-sm text-slate-500">What resellers charge, what we bill them at {money(WHOLESALE_PRICE)}/active subaccount, and their margin.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Resellers" value={totals.resellers} />
        <StatCard label="Active subaccounts" value={totals.active} />
        <StatCard label="Our MRR" value={money(totals.ourMrr)} accent="text-emerald-300" sub="all active × wholesale" />
        <StatCard label="Reseller gross" value={money(totals.gross)} sub="what resellers collect" />
        <StatCard label="Resellers' margin" value={money(totals.margin)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : (
        <Table
          head={['Reseller', 'Client price', 'Active', 'Gross revenue', 'Our revenue', 'Margin', 'Billing', '']}
          rows={rows.map((a) => [
            <div className="flex items-center gap-2.5">
              <Avatar name={a.name} color={a.primary_color} />
              <div>
                <span className="font-medium text-slate-100">{a.name}</span>
                {!a.configured && <span className="ml-2 text-xs text-slate-500">(SaaS not set up)</span>}
              </div>
            </div>,
            a.configured ? `${money(a.price)}/mo` : '—',
            <span className="text-primary-300">{a.active}</span>,
            money(a.gross),
            money(a.ourRevenue),
            <span className={a.margin >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{money(a.margin)}</span>,
            a.suspended
              ? <Badge className="bg-rose-500/15 text-rose-300">Past due</Badge>
              : <Badge className="bg-emerald-500/15 text-emerald-300">Current</Badge>,
            <div className="flex items-center gap-1.5" onClick={stop}>
              <button onClick={() => navigate(`/admin/agencies/${a.id}`)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="View clients">
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setEditing(a)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="Edit wholesale rate">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => billNow(a)} disabled={busyId === a.id} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-sky-300 transition hover:bg-surface-700 disabled:opacity-40" title="Bill now">
                {busyId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => toggleSuspend(a)} disabled={busyId === a.id} className={`rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs transition hover:bg-surface-700 disabled:opacity-40 ${a.suspended ? 'text-emerald-300' : 'text-rose-300'}`} title={a.suspended ? 'Reactivate' : 'Suspend'}>
                {a.suspended ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
              </button>
            </div>,
          ])}
          empty="No resellers yet."
          icon={Building2}
          onRowClick={(i) => navigate(`/admin/agencies/${rows[i].id}`)}
        />
      )}

      {editing && (
        <EditRateModal
          agency={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load() }}
        />
      )}
    </div>
  )
}

function EditRateModal({ agency, onClose, onSaved }) {
  const [rate, setRate] = useState(String(agency.wholesale || WHOLESALE_PRICE))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const value = Number(rate)
    if (!Number.isFinite(value) || value < 0) { setError('Enter a valid rate.'); return }
    setBusy(true); setError('')
    const { error: err } = await supabase.from('agency_accounts').update({ reseller_wholesale_price: value }).eq('id', agency.id)
    if (err) { setError(err.message); setBusy(false); return }
    onSaved()
  }

  return (
    <Modal title={`Wholesale rate — ${agency.name}`} onClose={onClose} maxWidth="max-w-md" footer={
      <>
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={save} disabled={busy} className="btn-primary">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save rate</button>
      </>
    }>
      <div className="space-y-3">
        <p className="text-sm text-slate-400">What Hope AI bills this reseller per active subaccount, per month. Default is {money(WHOLESALE_PRICE)}.</p>
        <div>
          <label className="label">Wholesale rate (USD/active/mo)</label>
          <input className="input" type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  )
}
