import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  GraduationCap,
  Play,
  Pause,
  CheckCircle2,
  Check,
  Clock,
  X,
  Loader2,
  Sparkles,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { stripEmDashes, stripBrackets } from '../lib/sanitize'
import { formatDuration } from '../lib/consults'
import { fetchTrainingRecommendation } from '../lib/insights'
import { useTrainingCatalog, useMarkTrainingComplete, queryKeys } from '../lib/queries'

const REC_TTL = 24 * 60 * 60 * 1000 // re-generate the AI recommendation at most once a day

export default function Training() {
  const { user, practiceId } = useAuth()
  const [rec, setRec] = useState(null) // { recommendation, focus_area, based_on }
  const [recLoading, setRecLoading] = useState(true)
  const [recError, setRecError] = useState(false)
  const queryClient = useQueryClient()
  const { data: catalog, isLoading: loading } = useTrainingCatalog(user?.id)
  const modules = catalog?.modules ?? []
  const groups = catalog?.groups ?? []
  const progress = catalog?.progress ?? {}
  const markCompleteMutation = useMarkTrainingComplete()
  const [activeGroup, setActiveGroup] = useState(null) // active module tab (group key)
  const [playing, setPlaying] = useState(null) // module being watched
  const [saving, setSaving] = useState(false)
  const videoRef = useRef(null)
  // Custom-player UI state — presentational only, all driven off the same <video> ref.
  const [isPlaying, setIsPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(1)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    if (groups.length && !activeGroup) setActiveGroup(groups[0]?.key || null)
  }, [groups, activeGroup])

  // Fetch the AI recommendation, cached per-practice in localStorage so we don't
  // re-call Claude on every visit. Pure: returns a result, never sets state, so
  // callers control when state updates happen.
  async function loadRec(pid, force) {
    if (!pid) return { skip: true }
    const cacheKey = `ciq_training_rec_v2_${pid}`
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
      // Only cache real AI results with an actual recommendation; retry next load
      // when we fell back to the local heuristic OR got the empty "record a few
      // consults" placeholder (based_on 0), so a real rec isn't masked by a cache.
      if (data?.source !== 'heuristic' && (data?.based_on ?? 0) > 0) {
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
    try {
      await markCompleteMutation.mutateAsync({ userId: user.id, moduleId })
      queryClient.invalidateQueries({ queryKey: queryKeys.training.modules() })
    } finally {
      setSaving(false)
    }
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

  // Overall progress across every module (all groups).
  const overallPct = modules.length ? Math.round((completedCount / modules.length) * 100) : 0

  // The module the AI recommendation points at, so the card can deep-link to it.
  // The prompt forces the model to name a module verbatim, so we match the longest
  // module title that appears in the recommendation text (falling back to an exact
  // focus_area title match). Brackets are ignored to mirror what the user reads.
  const recommendedModule = useMemo(() => {
    if (!modules.length) return null
    const text = stripBrackets(rec?.recommendation || '').toLowerCase()
    const inText = modules
      .filter((m) => m.title && text.includes(m.title.toLowerCase()))
      .sort((a, b) => b.title.length - a.title.length)
    if (inText[0]) return inText[0]
    const fa = rec?.focus_area?.trim().toLowerCase()
    return (fa && modules.find((m) => m.title?.toLowerCase() === fa)) || null
  }, [rec, modules])

  // ── Custom video player (presentational; wraps the existing <video> ref) ──
  // Bind player chrome to the native media events. Re-runs whenever a new
  // lesson mounts the <video> element.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurTime(v.currentTime)
    const onMeta = () => setDur(v.duration || 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [playing])

  // Open a lesson in the player, resetting the scrubber for the new video.
  function openLesson(m) {
    setCurTime(0)
    setDur(0)
    setIsPlaying(false)
    setPlaying(m)
  }

  // Open a module that may live under a different tab (e.g. the AI rec deep-link):
  // switch to its tab first so the modal's progress strip and prev/next stay correct.
  function openModule(m) {
    if (!m) return
    if (m.module_group && m.module_group !== activeGroup) setActiveGroup(m.module_group)
    openLesson(m)
  }

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }
  function skip(sec) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.min(Math.max(0, v.currentTime + sec), v.duration || 0)
  }
  function onScrub(e) {
    const v = videoRef.current
    if (!v || !v.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.min(Math.max(0, (e.clientX - rect.left) / rect.width), 1)
    v.currentTime = pct * v.duration
  }
  function cycleSpeed() {
    const v = videoRef.current
    if (!v) return
    const speeds = [1, 1.25, 1.5, 2, 0.75]
    const next = speeds[(speeds.indexOf(rate) + 1) % speeds.length] ?? 1
    v.playbackRate = next
    setRate(next)
  }
  function toggleMute() {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }
  function toggleFullscreen() {
    const v = videoRef.current
    if (!v) return
    if (document.fullscreenElement) document.exitFullscreen?.()
    else v.requestFullscreen?.() ?? v.webkitEnterFullscreen?.()
  }
  function fmtTime(s) {
    if (!s || Number.isNaN(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  // ── Lesson navigation within the active module tab (UI state only) ──
  const playingIndex = playing ? visible.findIndex((m) => m.id === playing.id) : -1
  function goToPrevLesson() {
    if (playingIndex > 0) openLesson(visible[playingIndex - 1])
  }
  function goToNextLesson() {
    if (playingIndex >= 0 && playingIndex < visible.length - 1) openLesson(visible[playingIndex + 1])
  }

  // First not-yet-completed lesson in the active tab (for "Continue module →").
  const nextUpInGroup = visible.find((m) => !progress[m.id]?.completed_at) || visible[0] || null

  const scrubPct = dur ? (curTime / dur) * 100 : 0
  const groupDone = visible.filter((m) => progress[m.id]?.completed_at).length
  const minsRemaining = Math.round(
    visible.filter((m) => !progress[m.id]?.completed_at).reduce((s, m) => s + (m.duration || 0), 0) / 60,
  )

  return (
    <div className="space-y-6">
      {/* Hero: page label + title on the left, AI recommendation card on the right */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="flex flex-col gap-1 lg:w-1/3 lg:shrink-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Training
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white">CaseLift Academy</h1>
        </div>

        {/* AI training recommendation — green so it reads as a distinct AI feature
            rather than matching the sub-account's white-label accent. */}
        <div className="w-full rounded-xl border border-emerald-500/30 border-l-2 border-l-emerald-500 bg-emerald-500/10 p-4 ring-1 ring-emerald-500/10 lg:w-2/3">
          <div className="flex items-start gap-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                  AI Recommendation
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                </span>
                <button
                  onClick={refreshRec}
                  disabled={recLoading || !practiceId}
                  title="Regenerate"
                  className="rounded p-1 text-slate-500 transition hover:bg-surface-700 hover:text-slate-300 disabled:opacity-40"
                >
                  <RefreshCw className={`h-3 w-3 ${recLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {recLoading ? (
                <div className="mt-2 space-y-1.5">
                  <div className="h-2.5 w-full animate-pulse rounded bg-surface-700" />
                  <div className="h-2.5 w-4/5 animate-pulse rounded bg-surface-700" />
                </div>
              ) : recError ? (
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Couldn’t generate a recommendation right now.{' '}
                  <button onClick={refreshRec} className="font-medium text-primary-300 hover:underline">
                    Try again
                  </button>
                  .
                </p>
              ) : (
                <>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
                    {stripBrackets(stripEmDashes(rec?.recommendation))}
                  </p>
                  {recommendedModule ? (
                    <button
                      onClick={() => openModule(recommendedModule)}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold !text-white transition hover:bg-emerald-500"
                    >
                      <Play className="h-3 w-3" /> Watch: {recommendedModule.title}
                    </button>
                  ) : (
                    rec?.focus_area && (
                      <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        <GraduationCap className="h-3 w-3" /> {rec.focus_area}
                      </span>
                    )
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Overall progress across every module */}
      {!loading && modules.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-700">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium text-slate-400">
            {completedCount} / {modules.length} · {overallPct}%
          </span>
        </div>
      )}

      {/* Module tabs (editable in the Super Admin Training tab) */}
      <div className="flex flex-wrap gap-1 border-b border-surface-700">
        {groups.map((g) => {
          const isActive = g.key === activeGroup
          const cc = groupCounts[g.key] || { total: 0, done: 0 }
          const groupComplete = cc.total > 0 && cc.done === cc.total
          return (
            <button
              key={g.key}
              onClick={() => setActiveGroup(g.key)}
              className={[
                '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition',
                isActive
                  ? 'border-primary font-medium text-white'
                  : 'border-transparent font-normal text-slate-400 hover:text-slate-200',
              ].join(' ')}
            >
              {g.name}
              {groupComplete ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <span className="text-xs text-slate-500">
                  {cc.done} / {cc.total}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Module intro + lesson list */}
      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500">Loading modules…</div>
      ) : visible.length === 0 ? (
        <div className="card px-6 py-16 text-center">
          <GraduationCap className="mx-auto h-9 w-9 text-slate-600" />
          <p className="mt-3 text-sm text-slate-400">No lessons in this module yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Module intro block */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[15px] font-medium text-white">
                {groups.find((g) => g.key === activeGroup)?.name || 'Module'}
              </h2>
              <p className="mt-1 max-w-[480px] text-xs leading-relaxed text-slate-400">
                {groupDone} of {visible.length} lesson{visible.length === 1 ? '' : 's'} complete in this
                module.
              </p>
            </div>
            {nextUpInGroup && (
              <button
                onClick={() => openLesson(nextUpInGroup)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary-300 transition hover:bg-primary/10"
              >
                Continue module <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Lesson list */}
          <div className="overflow-hidden rounded-xl border border-surface-700">
            {visible.map((m, i) => {
              const p = progress[m.id]
              const completed = Boolean(p?.completed_at)
              const inProgress = !completed && (p?.progress || 0) > 0
              const pct = completed ? 100 : p?.progress || 0
              const isCurrent = (playing?.id ?? nextUpInGroup?.id) === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => openLesson(m)}
                  className={[
                    'flex w-full items-center gap-4 border-b border-surface-700 px-4 py-3 text-left transition last:border-b-0 hover:bg-surface-800',
                    isCurrent ? 'border-l-2 border-l-primary' : 'border-l-2 border-l-transparent',
                  ].join(' ')}
                >
                  {/* Number */}
                  <span className="w-5 shrink-0 text-[11px] tabular-nums text-slate-500">
                    {String(i + 1).padStart(2, '0')}
                  </span>

                  {/* State icon */}
                  <span
                    className={[
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      completed
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : inProgress
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-surface-700 text-slate-400',
                    ].join(' ')}
                  >
                    <Play className="h-4 w-4" />
                  </span>

                  {/* Title + duration */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-100">
                      {m.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                      <Clock className="h-3 w-3" /> {formatDuration(m.duration) || '—'}
                    </span>
                  </span>

                  {/* Progress bar */}
                  <span className="hidden h-[3px] w-20 shrink-0 overflow-hidden rounded-full bg-surface-700 sm:block">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </span>

                  {/* Status */}
                  <span className="flex w-16 shrink-0 items-center justify-end">
                    {completed ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                        <Check className="h-3.5 w-3.5" /> Done
                      </span>
                    ) : inProgress ? (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white">
                        <Play className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <Play className="h-3.5 w-3.5 text-slate-600" />
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Video player modal */}
      {playing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setPlaying(null)}
          />
          <div className="relative z-10 w-full max-w-[680px] overflow-hidden rounded-2xl bg-surface-900 shadow-card">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                  {groups.find((g) => g.key === playing.module_group)?.name || playing.category}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={goToPrevLesson}
                    disabled={playingIndex <= 0}
                    className="rounded-md p-1 text-slate-400 transition hover:bg-surface-800 hover:text-white disabled:opacity-30"
                    title="Previous lesson"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="whitespace-nowrap text-xs text-slate-400">
                    Lesson {playingIndex + 1} of {visible.length}
                  </span>
                  <button
                    onClick={goToNextLesson}
                    disabled={playingIndex >= visible.length - 1}
                    className="rounded-md p-1 text-slate-400 transition hover:bg-surface-800 hover:text-white disabled:opacity-30"
                    title="Next lesson"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <button
                onClick={() => setPlaying(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-800 text-slate-400 transition hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Video player area */}
            <div className="group relative aspect-video w-full bg-black">
              <video
                ref={videoRef}
                src={playing.video_url}
                controls={false}
                autoPlay
                onClick={togglePlay}
                onEnded={() => markComplete(playing.id)}
                className="h-full w-full"
              />

              {/* Paused overlay */}
              {!isPlaying && (
                <button
                  onClick={togglePlay}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/40"
                >
                  <span className="max-w-[80%] text-center text-base font-medium text-white">
                    {playing.title}
                  </span>
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg">
                    <Play className="h-6 w-6 translate-x-0.5" />
                  </span>
                </button>
              )}

              {/* Custom controls bar */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6">
                {/* Scrubber */}
                <div
                  onClick={onScrub}
                  className="group/scrub relative mb-2 h-[3px] cursor-pointer rounded-full bg-white/25"
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    style={{ width: `${scrubPct}%` }}
                  />
                  <div
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 transition group-hover/scrub:opacity-100"
                    style={{ left: `${scrubPct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-white">
                  {/* Left controls */}
                  <div className="flex items-center gap-1.5">
                    <button onClick={togglePlay} className="rounded p-1 transition hover:bg-white/10" title="Play / pause">
                      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button onClick={() => skip(-15)} className="rounded p-1 transition hover:bg-white/10" title="Back 15s">
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button onClick={() => skip(15)} className="rounded p-1 transition hover:bg-white/10" title="Forward 15s">
                      <RotateCw className="h-4 w-4" />
                    </button>
                    <span className="ml-1 text-[11px] tabular-nums text-white/80">
                      {fmtTime(curTime)} / {fmtTime(dur)}
                    </span>
                  </div>

                  {/* Right controls */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={cycleSpeed}
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums transition hover:bg-white/10"
                      title="Playback speed"
                    >
                      {rate}x
                    </button>
                    <button onClick={toggleMute} className="rounded p-1 transition hover:bg-white/10" title="Mute">
                      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                    <button onClick={toggleFullscreen} className="rounded p-1 transition hover:bg-white/10" title="Fullscreen">
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Module progress strip */}
            <div className="border-b border-surface-700 px-5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Module progress
              </p>
              <div className="mt-2 flex gap-1">
                {visible.map((m) => {
                  const done = Boolean(progress[m.id]?.completed_at)
                  const current = m.id === playing.id
                  return (
                    <span
                      key={m.id}
                      className={[
                        'h-[3px] flex-1 rounded-full',
                        done ? 'bg-emerald-400' : current ? 'bg-primary' : 'bg-surface-700',
                      ].join(' ')}
                    />
                  )
                })}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {groupDone} of {visible.length} completed
                </span>
                <span>~{minsRemaining} min remaining</span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-white">{playing.title}</p>
                {playing.description && (
                  <p className="mt-1 max-w-[360px] text-xs leading-relaxed text-slate-400">
                    {playing.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  onClick={() => markComplete(playing.id)}
                  disabled={saving || Boolean(progress[playing.id]?.completed_at)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {progress[playing.id]?.completed_at ? 'Completed' : 'Mark complete'}
                </button>
                <button
                  onClick={goToNextLesson}
                  disabled={playingIndex >= visible.length - 1}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-surface-600 bg-surface-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-surface-700 disabled:opacity-40"
                >
                  Next lesson <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
