import { lazy, Suspense, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Clock,
  Award,
  TrendingUp,
  Network,
  Plug,
  DollarSign,
  Info,
  Trophy,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Link, Navigate } from 'react-router-dom'
import AILearningFeed from '../components/AILearningFeed'
import TodaysAppointmentsSnapshot from '../components/TodaysAppointmentsSnapshot'
import { SkeletonStatGrid } from '../components/Skeleton'
const RecordingRateCard = lazy(() => import('../components/RecordingRateCard'))
const PerformanceInsights = lazy(() => import('../components/PerformanceInsights'))
import ErrorState, { friendlyError } from '../components/ErrorState'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../lib/analytics'
import {
  computeAttributedProduction,
  countSentMessages,
  closeRateForRows,
} from '../lib/dashboard'
import { useDashboard, useNetworkComparison } from '../lib/queries'

function parseDate(d) {
  if (!d) return null
  const [y, m, day] = String(d).split('-').map(Number)
  return y ? new Date(y, m - 1, day) : new Date(d)
}
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function startOfWeek() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d
}
function startOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function CompareRow({ label, you, network, suffix = '' }) {
  const better = you >= network
  return (
    <div className="rounded-lg border border-surface-700 bg-surface-800/40 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className={`text-lg font-bold ${better ? 'text-emerald-400' : 'text-rose-400'}`}>
          {you}
          {suffix}
        </span>
        <span className="text-xs text-slate-500">
          net {network}
          {suffix}
        </span>
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub, accent = 'primary', to }) {
  const accents = {
    primary: 'bg-primary/10 text-primary-400',
    green: 'bg-emerald-500/10 text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-400',
    violet: 'bg-[var(--accent-subtle)] text-[var(--accent)]',
    sky: 'bg-sky-500/10 text-sky-400',
  }
  const valueTone = accent === 'green' ? 'text-emerald-300' : 'text-white'
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accents[accent] || accents.primary}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className={`mt-3 text-3xl font-bold tracking-tight ${valueTone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </>
  )
  return to
    ? <Link to={to} className="card p-5 transition hover:bg-surface-800/60">{body}</Link>
    : <div className="card p-5">{body}</div>
}

export default function Dashboard() {
  const { practiceId, practice, user, isAgencyUser } = useAuth()
  const { data, isLoading: loading, error, refetch } = useDashboard(practiceId)
  const { data: comparison } = useNetworkComparison(practiceId)

  // Assisted wins this month (count + summed case value) from assisted_wins.
  const { data: winsData } = useQuery({
    queryKey: ['assisted-wins', practiceId, 'month'],
    enabled: Boolean(practiceId),
    queryFn: async () => {
      const { data } = await supabase
        .from('assisted_wins')
        .select('case_value')
        .eq('practice_id', practiceId)
        .gte('won_at', startOfMonth().toISOString())
      const rows = data || []
      return { count: rows.length, value: rows.reduce((s, r) => s + (Number(r.case_value) || 0), 0) }
    },
  })
  const wins = winsData || { count: 0, value: 0 }

  const consults = data?.consults ?? []
  const messages = data?.messages ?? []
  const dashExtras = data?.dashExtras ?? {
    sentConsultIds: new Set(),
    repliedConsultIds: new Set(),
    inboundRepliesWeek: 0,
    messageOutcomes: [],
  }
  const implantApptsWeek = data?.implantApptsWeek ?? 0

  const prodMetrics = useMemo(
    () =>
      computeAttributedProduction(consults, practice, {
        sentSet: dashExtras.sentConsultIds,
        repliedSet: dashExtras.repliedConsultIds,
      }),
    [consults, practice, dashExtras.sentConsultIds, dashExtras.repliedConsultIds],
  )

  const closeRateThisMonth = useMemo(() => {
    const thisKey = monthKey(new Date())
    const rows = consults.filter((c) => {
      const d = parseDate(c.recording_date)
      return d && monthKey(d) === thisKey
    })
    return closeRateForRows(rows)
  }, [consults])

  const activity = useMemo(() => {
    const weekStart = startOfWeek()
    const monthStart = startOfMonth()
    const recordedThisWeek = consults.filter((c) => {
      const d = parseDate(c.recording_date)
      return d && d >= weekStart
    }).length
    const active = consults.filter((c) => c.status === 'active').length
    const acceptedThisMonth = consults.filter((c) => {
      const d = parseDate(c.recording_date)
      return c.status === 'closed_won' && d && d >= monthStart
    }).length
    return { recordedThisWeek, active, acceptedThisMonth }
  }, [consults])

  const kpis = useMemo(() => {
    const monthStart = startOfMonth()
    const avgSetting = Number(practice?.avg_case_value) || 30000
    const pipelineValue = activity.active * avgSetting
    const minPerFollowup = 5
    const messagesSent = countSentMessages(messages)
    const hoursSaved = Math.round((messagesSent * minPerFollowup / 60) * 10) / 10
    const monthRows = consults.filter((c) => { const d = parseDate(c.recording_date); return d && d >= monthStart })
    const activated = monthRows.filter((c) => ['approved', 'active'].includes(c.status)).length
    const activationRate = monthRows.length ? Math.round((activated / monthRows.length) * 100) : 0
    const recordingRate = implantApptsWeek
      ? Math.round((activity.recordedThisWeek / implantApptsWeek) * 100)
      : (activity.recordedThisWeek ? 100 : 0)
    const replyRate = activity.active
      ? Math.min(100, Math.round((dashExtras.inboundRepliesWeek / activity.active) * 100))
      : 0

    return {
      pipelineValue,
      hoursSaved,
      messagesSent,
      minPerFollowup,
      roi: prodMetrics.roi,
      recordingRate,
      activationRate,
      replyRate,
      closeRate: closeRateThisMonth,
    }
  }, [consults, messages, activity, practice, implantApptsWeek, dashExtras.inboundRepliesWeek, prodMetrics.roi, closeRateThisMonth])

  if (isAgencyUser && !practiceId) {
    return <Navigate to="/agency" replace />
  }

  const pmsConnected = Boolean(practice?.sikka_connected || practice?.pms_connected)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}. Here's what CaseLift has been working on.
        </h1>
        <p className="mt-1 text-slate-400">
          Here's how your practice is recovering unconverted patients this month.
        </p>
      </div>

      {!practiceId && !loading && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Your account isn't linked to a practice yet. Finish setup in{' '}
          <Link to="/settings" className="font-medium underline">Settings</Link>.
        </div>
      )}

      {practiceId && !pmsConnected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-slate-200">
          <span className="flex items-center gap-2">
            <Plug className="h-4 w-4 shrink-0 text-primary-300" />
            Connect your PMS to see appointments and record consults from your schedule.
          </span>
          <Link to="/settings/pms" className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold !text-white transition hover:bg-primary-500">
            Connect your PMS
          </Link>
        </div>
      )}

      {error ? (
        <ErrorState message={friendlyError(error)} onRetry={() => refetch()} />
      ) : (
        <>
          {loading ? (
            <SkeletonStatGrid count={4} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm text-slate-400">
                    Production Lifted by CaseLift
                    <Info
                      className="h-3.5 w-3.5 cursor-help text-slate-500"
                      title="Confirmed = actual treatment plan values from your PMS or manual entry, attributed to CaseLift."
                    />
                  </p>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                    <DollarSign className="h-[18px] w-[18px]" />
                  </span>
                </div>
                <p className="mt-3 text-3xl font-bold tracking-tight text-emerald-300">
                  {formatMoney(prodMetrics.confirmed)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Confirmed recovered · {prodMetrics.attributedCount} CaseLift-attributed
                  {prodMetrics.pipeline > 0 ? ` · ${formatMoney(prodMetrics.pipeline)} pipeline` : ''}
                </p>
              </div>
              <KpiCard icon={TrendingUp} accent="primary" label="Pipeline Value" value={formatMoney(kpis.pipelineValue)} sub={`${activity.active} patients nurtured`} />
              <KpiCard icon={Clock} accent="violet" label="Hours Saved" value={`${kpis.hoursSaved}h`} sub={`${kpis.messagesSent} auto follow-ups · ~${kpis.minPerFollowup} min each`} />
              <KpiCard icon={Award} accent="green" label="ROI This Month" value={kpis.roi ? `${kpis.roi}x ROI` : '-'} sub="Production ÷ $997 plan" />
              <KpiCard icon={Trophy} accent="green" label="Wins This Month" value={wins.count} sub={`${formatMoney(wins.value)} recovered · CaseLift-assisted`} />
            </div>
          )}

          {practiceId && (
            <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
              <Suspense fallback={<div className="card h-32 animate-pulse" />}>
                <RecordingRateCard practiceId={practiceId} />
              </Suspense>

              {comparison && comparison.practice && (
                <div className="card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Network className="h-4 w-4 text-primary-400" /> You vs the network
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                How your sequences compare to similar practices across CaseLift.
              </p>

              <div className="mt-4 rounded-xl border border-surface-700 bg-surface-800/50 p-4 text-center">
                <p className="text-sm text-slate-400">Your sequences are performing</p>
                <p
                  className={`mt-1 text-3xl font-bold tracking-tight ${
                    comparison.score >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {comparison.score >= 0 ? '+' : ''}
                  {comparison.score}%
                </p>
                <p className="text-sm text-slate-400">
                  {comparison.score >= 0 ? 'above' : 'below'} similar practices
                </p>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <CompareRow
                  label="Reply rate"
                  you={Math.round((comparison.practice.replyRate || 0) * 100)}
                  network={Math.round((comparison.network.replyRate || 0) * 100)}
                  suffix="%"
                />
                <CompareRow
                  label="Close rate"
                  you={Math.round((comparison.practice.closeRate || 0) * 100)}
                  network={Math.round((comparison.network.closeRate || 0) * 100)}
                  suffix="%"
                />
                <div className="rounded-lg border border-surface-700 bg-surface-800/40 p-3">
                  <p className="text-xs text-slate-500">Best message</p>
                  <p className="mt-1 text-sm font-semibold text-slate-200">
                    You: {comparison.practice.best ? `Msg ${comparison.practice.best.position}` : '-'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Network: {comparison.network.best ? `Msg ${comparison.network.best.position}` : '-'}
                  </p>
                </div>
              </div>
                </div>
              )}
            </div>
          )}

          {practiceId && pmsConnected && <TodaysAppointmentsSnapshot practiceId={practiceId} />}

          {practiceId && <AILearningFeed practiceId={practiceId} />}

          {practiceId && !loading && (
            <Suspense fallback={<div className="card h-64 animate-pulse" />}>
              <PerformanceInsights
                consults={consults}
                messageOutcomes={dashExtras.messageOutcomes}
                comparison={comparison}
                practiceId={practiceId}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  )
}
