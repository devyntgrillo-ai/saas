import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Pencil, ArrowUp, ArrowDown, Loader2, Send,
  Clock, Video, GraduationCap, AlertTriangle,
} from 'lucide-react'
import Modal from '../../components/Modal'
import { Badge } from '../../components/admin/ui'
import { supabase } from '../../lib/supabase'
import { useAuth, SUPER_ADMIN_EMAIL } from '../../context/AuthContext'
import {
  useAdminTrainingPage,
  useReorderTrainingLessons,
  useDeleteTrainingLesson,
  useSaveTrainingLesson,
  usePushTrainingLessons,
  isMutating,
  queryKeys,
} from '../../lib/queries'

// Lessons live in the single shared training_modules table. status drives the
// publish model: 'draft' (never live), 'published' ('Live'), 'updated' (edited
// since last push, hidden from practices until re-pushed). RLS lets the super
// admin see/manage everything; practices only see 'published'.
const CATEGORIES = ['TC Certification', 'Front Desk', 'Sales & Objections']

function statusMeta(status) {
  if (status === 'published') return { label: 'Live', cls: 'bg-emerald-500/15 text-emerald-300' }
  if (status === 'updated') return { label: 'Updated · Unpushed', cls: 'bg-amber-500/15 text-amber-300' }
  return { label: 'Draft', cls: 'bg-surface-700 text-slate-400' }
}
const minsFromSec = (s) => Math.round((Number(s) || 0) / 60)
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : null)

export default function TrainingAdmin() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { data, isLoading: loading, error: queryError, refetch } = useAdminTrainingPage()
  const [lessons, setLessons] = useState([])
  const [lastPush, setLastPush] = useState(null)
  const [groups, setGroups] = useState([])
  const [error, setError] = useState(queryError?.message || '')

  const [fGroup, setFGroup] = useState('all')
  const [fCategory, setFCategory] = useState('all')

  const [showModules, setShowModules] = useState(false)
  const [editing, setEditing] = useState(null) // lesson object, or {} for new
  const [confirmPush, setConfirmPush] = useState(false)
  const reorderMutation = useReorderTrainingLessons()
  const deleteMutation = useDeleteTrainingLesson()
  const saveLessonMutation = useSaveTrainingLesson()
  const pushMutation = usePushTrainingLessons()

  useEffect(() => {
    if (!data) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLessons(data.lessons)
    setLastPush(data.lastPush)
    setGroups(data.groups)
  }, [data])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [...queryKeys.admin.training(), 'page'] })

  // Curriculum view: lessons grouped under their module, in module order, each
  // module's lessons by order_index. Honors the module + category filters.
  // Lessons whose module_group matches no tab fall into an "Unassigned" section
  // so they're never lost.
  const sections = useMemo(() => {
    const byCat = (l) => fCategory === 'all' || l.category === fCategory
    const sortByOrder = (arr) => arr.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    const orderedGroups = [...groups].sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    const known = new Set(orderedGroups.map((g) => g.key))
    const result = []
    for (const g of orderedGroups) {
      if (fGroup !== 'all' && g.key !== fGroup) continue
      const ls = sortByOrder(lessons.filter((l) => l.module_group === g.key && byCat(l)))
      // When narrowing by category, hide modules that have nothing to show.
      if (ls.length === 0 && fCategory !== 'all') continue
      result.push({ group: g, lessons: ls })
    }
    if (fGroup === 'all') {
      const orphans = sortByOrder(lessons.filter((l) => !known.has(l.module_group) && byCat(l)))
      if (orphans.length) result.push({ group: { key: '__unassigned', name: 'Unassigned' }, lessons: orphans, orphan: true })
    }
    return result
  }, [lessons, groups, fGroup, fCategory])

  const shownCount = useMemo(() => sections.reduce((n, s) => n + s.lessons.length, 0), [sections])

  const unpushed = useMemo(
    () => lessons.filter((l) => l.status === 'draft' || l.status === 'updated').length,
    [lessons],
  )

  // Optimistic patch of a lesson. `markUpdated` flips a live lesson to 'updated'
  // (edited-since-push) so the change doesn't stay live until the next push.
  async function patchLesson(id, patch, { markUpdated = false } = {}) {
    const current = lessons.find((l) => l.id === id)
    const finalPatch = { ...patch }
    if (markUpdated && current?.status === 'published') finalPatch.status = 'updated'
    const prev = lessons
    setLessons((ls) => ls.map((l) => (l.id === id ? { ...l, ...finalPatch } : l)))
    const { error: e } = await supabase.from('training_modules').update(finalPatch).eq('id', id)
    if (e) { setError(e.message); setLessons(prev) }
  }

  async function toggleStatus(l) {
    // Direct draft <-> published toggle (also publishes an 'updated' lesson).
    await patchLesson(l.id, { status: l.status === 'published' ? 'draft' : 'published' })
  }

  async function reorder(l, list, dir) {
    const idx = list.findIndex((r) => r.id === l.id)
    const swapWith = list[idx + dir]
    if (!swapWith) return
    const a = l.order_index ?? 0
    const b = swapWith.order_index ?? 0
    setLessons((ls) => ls.map((x) =>
      x.id === l.id ? { ...x, order_index: b } : x.id === swapWith.id ? { ...x, order_index: a } : x))
    try {
      await reorderMutation.mutateAsync({ lessonId: l.id, swapLessonId: swapWith.id, orderA: a, orderB: b })
    } catch (e) {
      setError(e?.message || 'Could not reorder.')
      invalidate()
    }
  }

  async function removeLesson(l) {
    if (!window.confirm(`Delete "${l.title}"? This cannot be undone.`)) return
    const prev = lessons
    setLessons((ls) => ls.filter((x) => x.id !== l.id))
    try {
      await deleteMutation.mutateAsync({ id: l.id })
    } catch (e) {
      setError(e?.message || 'Could not delete.')
      setLessons(prev)
    }
  }

  async function publishAll() {
    if (!window.confirm('Set ALL lessons to Published?')) return
    const prev = lessons
    setLessons((ls) => ls.map((l) => ({ ...l, status: 'published' })))
    const { error: e } = await supabase
      .from('training_modules')
      .update({ status: 'published' })
      .neq('status', 'published')
    if (e) { setError(e.message); setLessons(prev) }
  }

  async function doPush() {
    const toPush = lessons.filter((l) => l.status === 'draft' || l.status === 'updated')
    const count = toPush.length
    try {
      await pushMutation.mutateAsync({ pushedBy: user?.email || SUPER_ADMIN_EMAIL, count })
      setConfirmPush(false)
      invalidate()
    } catch (e) {
      setError(e?.message || 'Push failed.')
    }
  }

  async function saveLesson(form) {
    if (form.id) {
      const payload = {
        title: form.title.trim(),
        module_group: form.module_group,
        description: form.description,
        duration: (Number(form.durationMin) || 0) * 60,
        video_url: form.video_url.trim() || null,
        category: form.category,
        status: form.status,
        order_index: Number(form.order_index) || 0,
      }
      const prev = lessons
      setLessons((ls) => ls.map((l) => (l.id === form.id ? { ...l, ...payload } : l)))
      try {
        await saveLessonMutation.mutateAsync({ form })
        return true
      } catch (e) {
        setError(e?.message || 'Save failed.')
        setLessons(prev)
        return false
      }
    }
    try {
      const result = await saveLessonMutation.mutateAsync({ form })
      if (result.created && result.row) setLessons((ls) => [...ls, result.row])
      return true
    } catch (e) {
      setError(e?.message || 'Save failed.')
      return false
    }
  }

  // ── Module tabs (training_module_groups) ──────────────────────────────────
  async function renameGroup(id, name) {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, name } : g)))
    const { error: e } = await supabase.from('training_module_groups').update({ name }).eq('id', id)
    if (e) setError(e.message)
  }
  async function reorderGroup(g, dir) {
    const sorted = [...groups].sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    const idx = sorted.findIndex((x) => x.id === g.id)
    const swap = sorted[idx + dir]
    if (!swap) return
    setGroups((gs) => gs.map((x) =>
      x.id === g.id ? { ...x, order_index: swap.order_index } : x.id === swap.id ? { ...x, order_index: g.order_index } : x))
    await Promise.all([
      supabase.from('training_module_groups').update({ order_index: swap.order_index }).eq('id', g.id),
      supabase.from('training_module_groups').update({ order_index: g.order_index }).eq('id', swap.id),
    ])
  }
  async function addGroup() {
    const order = groups.reduce((m, g) => Math.max(m, g.order_index || 0), 0) + 1
    const key = `mod-${order}-${String(Date.now()).slice(-6)}`
    const { data, error: e } = await supabase
      .from('training_module_groups')
      .insert({ key, name: 'New Module', order_index: order })
      .select().single()
    if (e) { setError(e.message); return }
    setGroups((gs) => [...gs, data])
  }
  async function deleteGroup(g) {
    const n = lessons.filter((l) => l.module_group === g.key).length
    if (!window.confirm(`Delete the "${g.name}" tab?${n ? ` ${n} lesson(s) are assigned to it and will be hidden until reassigned to another module.` : ''}`)) return
    setGroups((gs) => gs.filter((x) => x.id !== g.id))
    await supabase.from('training_module_groups').delete().eq('id', g.id)
  }

  return (
    <div className="space-y-6">
      {/* Header + push */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Training, TC Certification</h1>
            <p className="text-sm text-slate-500">Manage every course lesson from one place.</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={() => setConfirmPush(true)}
            disabled={unpushed === 0}
            className="btn-primary disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Push Updates to All Subaccounts{unpushed > 0 ? ` (${unpushed} unpushed)` : ''}
          </button>
          <p className="text-xs text-slate-500">
            {lastPush
              ? `Last pushed: ${fmtDate(lastPush.pushed_at)}${lastPush.lessons_pushed != null ? ` · ${lastPush.lessons_pushed} lessons` : ''}`
              : 'Never pushed yet'}
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">
          <Plus className="h-4 w-4" /> Add New Lesson
        </button>
        <button onClick={publishAll} className="btn-ghost">Publish All</button>
        <button onClick={() => setShowModules((v) => !v)} className="btn-ghost">Manage Module Tabs</button>
        <div className="ml-auto flex items-center gap-2">
          <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} className="input w-auto">
            <option value="all">All modules</option>
            {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
          </select>
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="input w-auto">
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Module-tab manager */}
      {showModules && (
        <div className="card p-5">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Module Tabs</h2>
            <button onClick={addGroup} className="btn-ghost !py-1.5 text-xs"><Plus className="h-3.5 w-3.5" /> Add module</button>
          </div>
          <p className="mb-3 text-xs text-slate-500">These are the horizontal tabs practices see. Rename or reorder them, lessons are grouped under their module.</p>
          <div className="space-y-2">
            {[...groups].sort((a, b) => (a.order_index || 0) - (b.order_index || 0)).map((g, i, arr) => (
              <div key={g.id} className="flex items-center gap-2 rounded-lg border border-surface-700 bg-surface-800/40 px-3 py-2">
                <div className="flex flex-col">
                  <button onClick={() => reorderGroup(g, -1)} disabled={i === 0} className="text-slate-500 hover:text-slate-200 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button onClick={() => reorderGroup(g, 1)} disabled={i === arr.length - 1} className="text-slate-500 hover:text-slate-200 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                </div>
                <input
                  defaultValue={g.name}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.name) renameGroup(g.id, v) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                  className="input flex-1 !py-1.5"
                />
                <span className="shrink-0 text-xs text-slate-500">{lessons.filter((l) => l.module_group === g.key).length} lessons</span>
                <button onClick={() => deleteGroup(g)} className="shrink-0 rounded-md border border-surface-700 bg-surface-800 p-1.5 text-rose-300 hover:bg-surface-700" title="Delete tab"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {groups.length === 0 && <p className="text-sm text-slate-500">No module tabs yet, add one.</p>}
          </div>
        </div>
      )}

      {/* Curriculum */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : shownCount === 0 ? (
        <div className="card px-4 py-16 text-center text-slate-400">No lessons match the filters.</div>
      ) : (
        <div className="space-y-4">
          {sections.map(({ group, lessons: ls, orphan }, si) => {
            const totalMin = ls.reduce((m, l) => m + minsFromSec(l.duration), 0)
            return (
              <section key={group.key} className="card p-4">
                {/* Module header */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    {!orphan && (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary-300">{si + 1}</span>
                    )}
                    <h3 className="text-sm font-semibold text-white">{group.name}</h3>
                    <span className="text-xs text-slate-500">
                      {ls.length} lesson{ls.length === 1 ? '' : 's'}{totalMin ? ` · ${totalMin} min` : ''}
                    </span>
                  </div>
                  {!orphan && (
                    <button onClick={() => setEditing({ module_group: group.key })} className="btn-ghost !py-1.5 text-xs">
                      <Plus className="h-3.5 w-3.5" /> Add lesson
                    </button>
                  )}
                </div>

                {/* Lessons */}
                {ls.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-surface-700 px-3 py-6 text-center text-sm text-slate-500">No lessons in this module yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {ls.map((l, i) => {
                      const meta = statusMeta(l.status)
                      const busy = isMutating(reorderMutation, (v) => v.lessonId === l.id)
                      return (
                        <li key={l.id} className="flex items-start gap-3 rounded-xl border border-surface-700/70 bg-surface-800/40 px-3 py-2.5 transition hover:border-surface-600 hover:bg-surface-800/70">
                          {/* Reorder + position */}
                          <div className="flex flex-col items-center pt-0.5 text-slate-500">
                            <button onClick={() => reorder(l, ls, -1)} disabled={i === 0 || busy} className="hover:text-slate-200 disabled:opacity-30" title="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                            <span className="my-0.5 text-[11px] tabular-nums">{i + 1}</span>
                            <button onClick={() => reorder(l, ls, 1)} disabled={i === ls.length - 1 || busy} className="hover:text-slate-200 disabled:opacity-30" title="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                          </div>

                          {/* Title + description + meta */}
                          <div className="min-w-0 flex-1">
                            <InlineEdit value={l.title} onSave={(v) => patchLesson(l.id, { title: v }, { markUpdated: true })} className="font-medium text-slate-100" placeholder="Untitled lesson" />
                            <InlineEdit value={l.description} textarea placeholder="Add description…" onSave={(v) => patchLesson(l.id, { description: v }, { markUpdated: true })} className="mt-0.5 text-sm text-slate-400" />
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5 shrink-0" />
                                <InlineEdit value={String(minsFromSec(l.duration))} number inline onSave={(v) => patchLesson(l.id, { duration: (Number(v) || 0) * 60 }, { markUpdated: true })} className="text-slate-400" /> min
                              </span>
                              {l.video_url ? (
                                <a href={l.video_url} target="_blank" rel="noreferrer" className="inline-flex max-w-[280px] items-center gap-1 text-primary-300 hover:text-primary-200">
                                  <Video className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{l.video_url}</span>
                                </a>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-slate-500">
                                  <Video className="h-3.5 w-3.5 shrink-0" />
                                  <InlineEdit value="" inline placeholder="Add video URL" onSave={(v) => patchLesson(l.id, { video_url: v.trim() || null }, { markUpdated: true })} className="italic" />
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Status + actions */}
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <button onClick={() => toggleStatus(l)} title="Toggle publish/draft">
                              <Badge className={meta.cls}>{meta.label}</Badge>
                            </button>
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => setEditing(l)} className="rounded-md border border-surface-700 bg-surface-800 p-1.5 text-slate-300 hover:bg-surface-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                              <button onClick={() => removeLesson(l)} disabled={isMutating(deleteMutation, (v) => v.id === l.id)} className="rounded-md border border-surface-700 bg-surface-800 p-1.5 text-rose-300 hover:bg-surface-700 disabled:opacity-40" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      {editing && (
        <LessonModal
          lesson={editing}
          groups={groups}
          saving={saveLessonMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={async (form) => { const ok = await saveLesson(form); if (ok) setEditing(null) }}
        />
      )}

      {confirmPush && (
        <Modal title="Push updates" onClose={() => setConfirmPush(false)} maxWidth="max-w-md" footer={
          <>
            <button onClick={() => setConfirmPush(false)} className="btn-ghost">Cancel</button>
            <button onClick={doPush} disabled={pushMutation.isPending} className="btn-primary">
              {pushMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Confirm Push
            </button>
          </>
        }>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <p className="text-sm text-slate-300">
              This will publish all updated lessons to every active practice
              {unpushed > 0 ? <> (<span className="font-semibold text-white">{unpushed}</span> lesson{unpushed === 1 ? '' : 's'})</> : ''}. Are you sure?
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Click-to-edit cell. Text by default; `textarea`/`number` switch input type.
// `inline` renders a compact, in-flow control (for the duration/video meta line)
// instead of the default full-width block used for the title/description.
function InlineEdit({ value, onSave, className = '', placeholder = '', textarea = false, number = false, inline = false }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value ?? '')
  useEffect(() => { setVal(value ?? '') }, [value]) // eslint-disable-line react-hooks/set-state-in-effect

  function commit() {
    setEditing(false)
    if ((val ?? '') !== (value ?? '')) onSave(val)
  }
  if (editing) {
    const width = number ? 'w-16' : inline ? 'w-48' : 'w-full'
    const common = {
      autoFocus: true,
      value: val,
      onChange: (e) => setVal(e.target.value),
      onBlur: commit,
      className: `input ${width} !py-1 !text-sm`,
    }
    if (textarea) return <textarea {...common} rows={2} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
    return <input {...common} type={number ? 'number' : 'text'} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
  }
  return (
    <button onClick={() => setEditing(true)} className={`${inline ? 'inline-block max-w-full align-baseline' : 'block w-full'} cursor-text truncate text-left hover:underline decoration-dotted ${className}`} title="Click to edit">
      {(value ?? '') === '' ? <span className="text-slate-600">{placeholder || ', '}</span> : value}
    </button>
  )
}

function LessonModal({ lesson, groups = [], onClose, onSave, saving = false }) {
  const isNew = !lesson?.id
  const [form, setForm] = useState({
    id: lesson?.id,
    title: lesson?.title || '',
    module_group: lesson?.module_group || groups[0]?.key || '',
    description: lesson?.description || '',
    durationMin: lesson?.duration != null ? minsFromSec(lesson.duration) : 15,
    video_url: lesson?.video_url || '',
    category: lesson?.category || CATEGORIES[0],
    status: lesson?.status === 'published' ? 'published' : 'draft',
    order_index: lesson?.order_index ?? 0,
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    if (!form.title.trim() || saving) return
    await onSave(form)
  }

  return (
    <Modal title={isNew ? 'Add Lesson' : 'Edit Lesson'} onClose={onClose} maxWidth="max-w-lg" footer={
      <>
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={submit} disabled={saving || !form.title.trim()} className="btn-primary">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </>
    }>
      <div className="space-y-4">
        <div><label className="label">Title</label><input className="input" value={form.title} onChange={set('title')} placeholder="Lesson title" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Module Group</label>
            <select className="input" value={form.module_group} onChange={set('module_group')}>
              {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label">Description</label><textarea className="input min-h-[80px]" value={form.description} onChange={set('description')} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Duration (minutes)</label><input type="number" min={0} className="input" value={form.durationMin} onChange={set('durationMin')} /></div>
          <div><label className="label">Order index</label><input type="number" className="input" value={form.order_index} onChange={set('order_index')} /></div>
        </div>
        <div><label className="label">Video URL</label><input className="input" value={form.video_url} onChange={set('video_url')} placeholder="https://…" /></div>
        <div>
          <label className="label">Status</label>
          <div className="flex gap-2">
            {['draft', 'published'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setForm((f) => ({ ...f, status: s }))}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition ${
                  form.status === s ? 'border-primary bg-primary/10 text-primary-300' : 'border-surface-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s === 'published' ? 'Published (Live)' : 'Draft'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
