import { useQuery } from '@tanstack/react-query'
import { Trophy, DollarSign, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { StatCard, Table, Badge, money } from '../../components/admin/ui'

// "dental_implants" -> "Dental Implants"
const pretty = (t) => (t || ', ').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : ', ')

// Super-admin view of every CaseLift-assisted win across all practices.
export default function Wins() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'wins'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assisted_wins')
        .select('*, practice:practices(name, company_name)')
        .order('won_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
  const wins = data || []
  const totalValue = wins.reduce((s, w) => s + (Number(w.case_value) || 0), 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthWins = wins.filter((w) => new Date(w.won_at) >= monthStart)
  const monthValue = monthWins.reduce((s, w) => s + (Number(w.case_value) || 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Wins</h1>
        <p className="text-sm text-slate-500">CaseLift-assisted closes across all practices.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Wins this month" value={monthWins.length} icon={Trophy} accent="text-emerald-300" />
        <StatCard label="Recovered this month" value={money(monthValue)} icon={DollarSign} accent="text-emerald-300" />
        <StatCard label="Total wins" value={wins.length} icon={Trophy} />
        <StatCard label="Total recovered" value={money(totalValue)} icon={DollarSign} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : (
        <Table
          head={['Practice', 'Patient', 'Treatment', 'Case Value', 'Messages Sent', 'Won Date', 'Source']}
          rows={wins.map((w) => [
            <span className="font-medium text-slate-100">{w.practice?.company_name || w.practice?.name || ', '}</span>,
            w.patient_name || ', ',
            pretty(w.treatment_type),
            <span className="text-emerald-300">{money(w.case_value)}</span>,
            <span className="text-primary-300">{w.messages_sent ?? ', '}</span>,
            fmtDate(w.won_at),
            <Badge className={w.won_by === 'manual' ? 'bg-primary/15 text-primary-300' : 'bg-surface-700 text-slate-300'}>
              {w.won_by === 'manual' ? 'Manual' : 'PMS'}
            </Badge>,
          ])}
          empty="No assisted wins recorded yet. They appear when a consult closes with CaseLift follow-up."
          icon={Trophy}
        />
      )}
    </div>
  )
}
