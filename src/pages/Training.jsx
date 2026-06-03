import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GraduationCap,
  Play,
  CheckCircle2,
  Clock,
  X,
  Loader2,
  Sparkles,
  RefreshCw,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { stripEmDashes } from '../lib/sanitize'
import { formatDuration } from '../lib/consults'
import { fetchTrainingRecommendation } from '../lib/insights'

const REC_TTL = 24 * 60 * 60 * 1000 // re-generate the AI recommendation at most once a day

export default function Training() {
  const { user, practiceId } = useAuth()
  const [rec, setRec] = useState(null) // { recommendation, focus_area, based_on }
  const [recLoading, setRecLoading] = useState(true)
  const [recError, setRecError] = useState(false)
  const [modules, setModules] = useState([])
  const [groups, setGroups] = useState([]) // editable module tabs (training_module_groups)
  const [progress, setProgress] = useState({}) // module_id -> { progress, completed_at }
  const [loading, setLoading] = useState(true)
  const [activeGroup, setActiveGroup] = useState(null) // active module tab (group key)
  const [playing, setPlaying] = useState(null) // module being watched
  const [saving, setSaving] = useState(false)
  const videoRef = useRef(null)

  useEffect(() => {
    let active = true
    async function load() {
      const [{ data: mods }, { data: prog }, { data: grps }] = await Promise.all([
        supabase.from('training_modules').select('*').order('order_index', { ascending: true }),
        user
          ? supabase.from('training_progress').select('module_id, progress, completed_at').eq('user_id', user.id)
          : Promise.resolve({ data: [] }),
        supabase.from('training_module_groups').select('*').order('order_index', { ascending: true }),
      ])
      if (!active) return
      setModules(mods || [])
      setGroups(grps || [])
      setActiveGroup((cur) => cur || grps?.[0]?.key || null)
      const map = {}
      for (const p of prog || []) map[p.module_id] = p
      setProgress(map)
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [user])

  // Fetch the AI recommendation, cached per-practice in localStorage so we don't
  // re-call Claude on every visit. Pure: returns a result, never sets state, so
  // callers control when state updates happen.
  async function loadRec(pid, force) {
    if (!pid) return { skip: true }
    const cacheKey = `ciq_training_rec_${pid}`
    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null')
        if (cached && Date.now() - cached.ts < REC_TTL) return { data: cached.data }
      } catch {
        /* ignore bad cache */
      }
    }
    try {
      const data = await fetchTrainingRecommendation(pid)
      // Only cache real AI results; retry the AI path next load when we had to
      // fall back to the local heuristic (e.g. edge function not yet deployed).
      if (data?.source !== 'heuristic') {
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data }))
      }
      return { data }
    } catch {
      return { error: true }
    }
  }

  // Manual refresh (force-regenerate), triggered by the button.
  async function refreshRec() {
    setRecLoading(true)
    setRecError(false)
    const res = await loadRec(practiceId, true)
    if (res.error) setRecError(true)
    else if (res.data) setRec(res.data)
    setRecLoading(false)
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      const res = await loadRec(practiceId, false)
      if (!active) return
      if (res.skip) setRecLoading(false)
      else if (res.error) {
        setRecError(true)
        setRecLoading(false)
      } else {
        setRec(res.data)
        setRecLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [practiceId])

  const visible = useMemo(
    () => modules.filter((m) => (m.module_group || '') === activeGroup),
    [modules, activeGroup]
  )

  const completedCount = useMemo(
    () => Object.values(progress).filter((p) => p.completed_at).length,
    [progress]
  )

  async function markComplete(moduleId) {
    if (!user) return
    setSaving(true)
    const row = {
      user_id: user.id,
      module_id: moduleId,
      progress: 100,
      completed_at: new Date().toISOString(),
    }
    const { error } = await supabase
      .from('training_progress')
      .upsert(row, { onConflict: 'user_id,module_id' })
    if (!error) {
      setProgress((prev) => ({ ...prev, [moduleId]: row }))
    }
    setSaving(false)
  }

  const groupCounts = useMemo(() => {
    const counts = {}
    for (const g of groups) {
      const total = modules.filter((m) => m.module_group === g.key).length
      const done = modules.filter((m) => m.module_group === g.key && progress[m.id]?.completed_at).length
      counts[g.key] = { total, done }
    }
    return counts
  }, [modules, groups, progress])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">CaseLift Academy</h1>
        <p className="text-sm text-slate-400">
          Everything your team needs to lift case acceptance.
          {!loading && modules.length > 0 && (
            <span className="ml-1 text-slate-500">
              {completedCount} of {modules.length} modules completed.
            </span>
          )}
        </p>
      </div>

      {/* AI training recommendation */}
      <div className="card border-l-2 border-l-primary p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                AI Training Recommendation
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
              </h2>
              <button
                onClick={refreshRec}
                disabled={recLoading || !practiceId}
                title="Regenerate"
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-surface-800 hover:text-white disabled:opacity-40"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${recLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {recLoading ? (
              <div className="mt-2.5 space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-surface-700" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-surface-700" />
              </div>
            ) : recError ? (
              <p className="mt-2 text-sm text-slate-400">
                Couldn’t generate a recommendation right now.{' '}
                <button
                  onClick={refreshRec}
                  className="font-medium text-primary-300 hover:underline"
                >
                  Try again
                </button>
                .
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  {stripEmDashes(rec?.recommendation)}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {rec?.focus_area && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary-300">
                      <GraduationCap className="h-3.5 w-3.5" /> Focus: {rec.focus_area}
                    </span>
                  )}
                  {rec?.based_on > 0 && (
                    <span className="text-xs text-slate-500">
                      Based on patterns from your last {rec.based_on} consult
                      {rec.based_on === 1 ? '' : 's'}.
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Module tabs (editable in the Super Admin Training tab) */}
      <div className="flex flex-wrap gap-2 border-b border-surface-700">
        {groups.map((g) => {
          const isActive = g.key === activeGroup
          const cc = groupCounts[g.key] || { total: 0, done: 0 }
          return (
            <button
              key={g.key}
              onClick={() => setActiveGroup(g.key)}
              className={[
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition',
                isActive
                  ? 'border-primary text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200',
              ].join(' ')}
            >
              {g.name}
              <span className="ml-2 text-xs text-slate-500">
                {cc.done}/{cc.total}
              </span>
            </button>
          )
        })}
      </div>

      {/* Module grid */}
      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500">Loading modules…</div>
      ) : visible.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <GraduationCap className="mx-auto h-9 w-9 text-slate-600" />
          <p className="mt-3 text-sm text-slate-400">No lessons in this module yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {visible.map((m) => {
            const p = progress[m.id]
            const completed = Boolean(p?.completed_at)
            const pct = completed ? 100 : p?.progress || 0
            return (
              <div key={m.id} className="card flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  {completed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Completed
                    </span>
                  )}
                </div>

                <h3 className="mt-3 text-sm font-semibold leading-snug text-slate-100">{m.title}</h3>
                <p className="mt-1.5 flex-1 text-xs leading-relaxed text-slate-400">{m.description}</p>

                <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" /> {formatDuration(m.duration) || '-'}
                </div>

                {/* Progress indicator */}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-700">
                  <div
                    className={`h-full rounded-full ${completed ? 'bg-emerald-400' : 'bg-primary'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <button
                  onClick={() => setPlaying(m)}
                  className="btn-primary mt-4 w-full"
                >
                  <Play className="h-4 w-4" />
                  {completed ? 'Rewatch' : 'Play'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Video player modal */}
      {playing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setPlaying(null)}
          />
          <div className="relative z-10 w-full max-w-3xl overflow-hidden rounded-xl border border-surface-700 bg-surface-900">
            <div className="flex items-center justify-between gap-3 border-b border-surface-700 px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{playing.title}</p>
                <p className="text-xs text-slate-500">
                  {playing.category} · {formatDuration(playing.duration)}
                </p>
              </div>
              <button
                onClick={() => setPlaying(null)}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-surface-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="bg-black">
              <video
                ref={videoRef}
                src={playing.video_url}
                controls
                autoPlay
                onEnded={() => markComplete(playing.id)}
                className="aspect-video w-full"
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-surface-700 px-5 py-3.5">
              <p className="text-xs text-slate-500">
                {progress[playing.id]?.completed_at
                  ? 'You’ve completed this module.'
                  : 'Finish the video or mark it complete below.'}
              </p>
              <button
                onClick={() => markComplete(playing.id)}
                disabled={saving || Boolean(progress[playing.id]?.completed_at)}
                className="btn-ghost disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {progress[playing.id]?.completed_at ? 'Completed' : 'Mark as complete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
