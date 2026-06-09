import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, Building2, Download, Loader2 } from 'lucide-react'
import { useAdmin } from '../../context/AdminContext'
import { isActiveSubaccount } from '../../lib/resellerSaas'
import { statusMeta as subStatusMeta } from '../../lib/billing'
import { StatCard, Badge, money } from '../../components/admin/ui'

// Manual monthly commission payout sheet: active referred practices grouped by
// agency, count × the agency's commission_rate. Read off here to pay by ACH.
// The amount comes from agency.commission_rate — the same field the "new
// referral" email reads — so the two can never drift.
export default function Commissions() {
  const { data, loading } = useAdmin()
  const navigate = useNavigate()
  const agencies = data?.agencies || []
  const practices = data?.practices || []

  const groups = useMemo(() => {
    return agencies
      .map((a) => {
        const active = practices.filter((p) => p.agency_id === a.id && isActiveSubaccount(p.subscription_status))
        return { agency: a, active, rate: a.commission_rate || 0, owed: active.length * (a.commission_rate || 0) }
      })
      .sort((x, y) => y.owed - x.owed)
  }, [agencies, practices])

  const totals = useMemo(
    () => ({
      agencies: groups.filter((g) => g.active.length > 0).length,
      practices: groups.reduce((s, g) => s + g.active.length, 0),
      owed: groups.reduce((s, g) => s + g.owed, 0),
    }),
    [groups],
  )

  function exportCsv() {
    const rows = [['Agency', 'Owner email', 'Active referred practices', 'Commission rate', 'Commission owed (monthly)']]
    for (const g of groups) {
      rows.push([g.agency.name, g.agency.owner_email || '', String(g.active.length), String(g.rate), String(g.owed)])
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'commission-payouts.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Commissions</h1>
          <p className="text-sm text-slate-500">Monthly referral payouts — active practices × each agency's rate. Pay manually by ACH.</p>
        </div>
        <button onClick={exportCsv} disabled={!groups.length} className="btn-ghost">
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Earning agencies" value={totals.agencies} icon={Building2} />
        <StatCard label="Active referred practices" value={totals.practices} icon={Building2} accent="text-primary-300" />
        <StatCard label="Total commission owed / mo" value={money(totals.owed)} icon={Wallet} accent="text-emerald-300" />
      </div>

      {loading ? (
        <div className="card flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : groups.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-slate-500">No agencies yet.</div>
      ) : (
        <div className="space-y-4">
          {groups.map(({ agency, active, rate, owed }) => (
            <div key={agency.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-700 px-5 py-3.5">
                <button
                  onClick={() => navigate(`/admin/agencies/${agency.id}`)}
                  className="text-left text-sm font-semibold text-white transition hover:text-primary-300"
                >
                  {agency.name}
                </button>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-slate-400">{active.length} active × {money(rate)}</span>
                  <span className="font-semibold text-emerald-300">{money(owed)}/mo</span>
                </div>
              </div>
              {active.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">No active referred practices.</p>
              ) : (
                <ul className="divide-y divide-surface-700">
                  {active.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <span className="min-w-0 truncate text-sm text-slate-200">{p.name}</span>
                      <Badge className={subStatusMeta(p.subscription_status).classes}>
                        {subStatusMeta(p.subscription_status).label}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
