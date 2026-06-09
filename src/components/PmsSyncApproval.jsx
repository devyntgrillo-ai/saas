import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Sparkles, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../lib/permissions'
import { discoverPmsConsults, approvePmsSync } from '../lib/pms'

function YearSlider({ label, value, onChange, disabled }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold text-white">{value} {value === 1 ? 'year' : 'years'}</span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-primary"
      />
    </div>
  )
}

function classificationBadge(c) {
  if (c === 'likely_consult') return 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20'
  if (c === 'likely_routine') return 'bg-slate-500/15 text-slate-300 ring-slate-400/20'
  return 'bg-amber-500/15 text-amber-300 ring-amber-400/20'
}

export default function PmsSyncApproval({ onApproved }) {
  const { practice, practiceId, refreshProfile } = useAuth()
  const { canManagePracticeSettings } = usePermissions()
  const [historyYears, setHistoryYears] = useState(practice?.pms_history_years ?? 1)
  const [forwardYears, setForwardYears] = useState(practice?.pms_forward_years ?? 1)
  const [clusters, setClusters] = useState([])
  const [stats, setStats] = useState(null)
  const [discovering, setDiscovering] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState(null)
  const autoDiscoveryRan = useRef(false)

  const rules = practice?.pms_sync_rules
  const status = practice?.pms_sync_status
  const approved = Boolean(practice?.pms_sync_approved_at)
  const hasRules = Boolean(rules?.clusters?.length)

  useEffect(() => {
    if (rules?.clusters?.length) {
      setClusters(rules.clusters.map((c) => ({ ...c })))
      setStats({
        total_scanned: rules.total_scanned,
        matched_count: rules.matched_count,
        excluded_count: rules.excluded_count,
        ai_used: rules.ai_used,
      })
      setHistoryYears(rules.history_years ?? practice?.pms_history_years ?? 1)
      setForwardYears(rules.forward_years ?? practice?.pms_forward_years ?? 1)
    }
  }, [rules, practice?.pms_history_years, practice?.pms_forward_years])

  const matchedPreview = useMemo(() => {
    if (!clusters.length) return 0
    return clusters.filter((c) => c.included).reduce((s, c) => s + (c.count || 0), 0)
  }, [clusters])

  const runDiscovery = useCallback(async (opts = {}) => {
    if (!practiceId || !canManagePracticeSettings) return
    const hist = opts.historyYears ?? historyYears
    const fwd = opts.forwardYears ?? forwardYears
    setDiscovering(true)
    setError(null)
    try {
      const data = await discoverPmsConsults(practiceId, { historyYears: hist, forwardYears: fwd })
      setClusters((data.rules?.clusters || []).map((c) => ({ ...c })))
      setStats({
        total_scanned: data.total_scanned,
        matched_count: data.matched_count,
        excluded_count: data.excluded_count,
        ai_used: data.ai_used,
      })
      await refreshProfile?.()
    } catch (e) {
      const msg = e?.message || 'Discovery failed'
      setError(msg)
    } finally {
      setDiscovering(false)
    }
  }, [practiceId, canManagePracticeSettings, historyYears, forwardYears, refreshProfile])

  // Auto-run discovery once when connected and no saved rules yet.
  useEffect(() => {
    if (autoDiscoveryRan.current) return
    if (!practice?.sikka_connected || !canManagePracticeSettings || approved) return
    if (hasRules || status === 'pending_approval') return
    if (discovering || approving) return
    autoDiscoveryRan.current = true
    runDiscovery()
  }, [practice?.sikka_connected, canManagePracticeSettings, approved, hasRules, status, discovering, approving, runDiscovery])

  // If server has rules but profile is stale, refresh once.
  useEffect(() => {
    if (status === 'pending_approval' && !hasRules) {
      refreshProfile?.()
    }
  }, [status, hasRules, refreshProfile])

  function toggleCluster(id) {
    setClusters((prev) => prev.map((c) => (c.id === id ? { ...c, included: !c.included } : c)))
  }

  async function handleApprove() {
    if (!practiceId) return
    setApproving(true)
    setError(null)
    try {
      await approvePmsSync(practiceId, {
        historyYears,
        forwardYears,
        clusters: clusters.map((c) => ({ id: c.id, included: c.included })),
      })
      await refreshProfile?.()
      onApproved?.()
    } catch (e) {
      setError(e.message || 'Approval failed')
    } finally {
      setApproving(false)
    }
  }

  if (!practice?.sikka_connected) return null

  if (approved && status === 'active') {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Consult sync active
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Only matched consult appointments sync to your schedule. History: {practice.pms_history_years ?? 1}y · Forward: {practice.pms_forward_years ?? 1}y
        </p>
        {canManagePracticeSettings && (
          <button type="button" onClick={() => { autoDiscoveryRan.current = false; runDiscovery() }} disabled={discovering} className="btn-ghost mt-3 text-xs">
            {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-scan appointment types
          </button>
        )}
      </div>
    )
  }

  if (!canManagePracticeSettings) {
    return (
      <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-4 text-sm text-slate-400">
        Consult sync setup is pending practice admin approval.
      </div>
    )
  }

  const showSpinner = discovering || (status === 'syncing' && !hasRules)

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-primary-400" /> Consult sync setup
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            We scan your PMS appointments, use AI to classify types, and only sync consults you approve.
          </p>
        </div>
        {showSpinner && (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary-300" />
        )}
      </div>

      {showSpinner && !hasRules && (
        <p className="text-xs text-slate-400">
          Scanning appointments and classifying types with AI — this can take 1–2 minutes. Appointment types will appear below when ready.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <YearSlider label="History (past)" value={historyYears} onChange={setHistoryYears} disabled={discovering || approving} />
        <YearSlider label="Forward look (future)" value={forwardYears} onChange={setForwardYears} disabled={discovering || approving} />
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg border border-surface-700 bg-surface-900/60 p-2">
            <p className="text-lg font-bold text-white">{stats.total_scanned}</p>
            <p className="text-slate-500">scanned</p>
          </div>
          <div className="rounded-lg border border-surface-700 bg-surface-900/60 p-2">
            <p className="text-lg font-bold text-emerald-300">{matchedPreview}</p>
            <p className="text-slate-500">matched consults</p>
          </div>
          <div className="rounded-lg border border-surface-700 bg-surface-900/60 p-2">
            <p className="text-lg font-bold text-slate-400">{Math.max(0, (stats.total_scanned || 0) - matchedPreview)}</p>
            <p className="text-slate-500">hidden</p>
          </div>
        </div>
      )}

      {stats?.ai_used && (
        <p className="text-xs text-slate-500">Classified with AI · check/uncheck types below, then approve</p>
      )}

      {clusters.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-slate-300">Appointment types to sync</p>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-surface-700 bg-surface-900/40 p-2">
            {clusters.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-surface-800/60">
                <input
                  type="checkbox"
                  checked={Boolean(c.included)}
                  onChange={() => toggleCluster(c.id)}
                  disabled={approving}
                  className="mt-1 h-4 w-4 rounded border-surface-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">{c.label}</span>
                    <span className="text-xs text-slate-500">({c.count})</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${classificationBadge(c.ai_classification)}`}>
                      {c.ai_classification?.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {c.ai_reason && <p className="mt-0.5 text-xs text-slate-500">{c.ai_reason}</p>}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
          <p className="flex items-center gap-2 text-sm text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
          <p className="mt-1 text-xs text-slate-400">Click &quot;Scan appointments&quot; to try again.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { autoDiscoveryRan.current = true; runDiscovery() }}
          disabled={discovering || approving}
          className="btn-ghost"
        >
          {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {clusters.length ? 'Re-scan' : 'Scan appointments'}
        </button>
        {clusters.length > 0 && (
          <button type="button" onClick={handleApprove} disabled={approving || discovering || matchedPreview === 0} className="btn-primary">
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Approve &amp; start sync ({matchedPreview} consults)
          </button>
        )}
      </div>
    </div>
  )
}
