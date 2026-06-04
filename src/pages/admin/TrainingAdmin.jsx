import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Pencil, ArrowUp, ArrowDown, Loader2, Send,
  ExternalLink, GraduationCap, AlertTriangle,
} from 'lucide-react'
import Modal from '../../components/Modal'
import { Badge } from '../../components/admin/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useAdminTrainingPage, queryKeys } from '../../lib/queries'

// Lessons live in the single shared training_modules table. status drives the
// publish model: 'draft' (never live), 'published' ('Live'), 'updated' (edited
// since last push — hidden from practices until re-pushed). RLS lets the super
// admin see/manage everything; practices only see 'published'.
const CATEGORIES = ['TC Certification', 'Front Desk', 'Sales & Objections']
const SUPER_ADMIN_EMAIL = 'devyntgrillo@gmail.com'

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
  const [pushing, setPushing] = useState(false)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!data) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLessons(data.lessons)
    setLastPush(data.lastPush)
    setGroups(data.groups)
  }, [data])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [...queryKeys.admin.training(), 'page'] })

  const groupName = useCallback(
    (key) => groups.find((g) => g.key === key)?.name || key || '—',
    [groups],
  )

  const rows = useMemo(() => {
    let list = [...lessons]
    if (fGroup !== 'all') list = list.filter((l) => l.module_group === fGroup)
    if (fCategory !== 'all') list = list.filter((l) => l.category === fCategory)
    return list.sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
  }, [lessons, fGroup, fCategory])

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

  async function reorder(l, dir) {
    const idx = rows.findIndex((r) => r.id === l.id)
    const swapWith = rows[idx + dir]
    if (!swapWith) return
    setBusyId(l.id)
    const a = l.order_index ?? 0
    const b = swapWith.order_index ?? 0
    setLessons((ls) => ls.map((x) =>
      x.id === l.id ? { ...x, order_index: b } : x.id === swapWith.id ? { ...x, order_index: a } : x))
    await Promise.all([
      supabase.from('training_modules').update({ order_index: b }).eq('id', l.id),
      supabase.from('training_modules').update({ order_index: a }).eq('id', swapWith.id),
    ])
    setBusyId(null)
  }

  async function removeLesson(l) {
    if (!window.confirm(`Delete "${l.title}"? This cannot be undone.`)) return
    setBusyId(l.id)
    const prev = lessons
    setLessons((ls) => ls.filter((x) => x.id !== l.id))
    const { error: e } = await supabase.from('training_modules').delete().eq('id', l.id)
    if (e) { setError(e.message); setLessons(prev) }
    setBusyId(null)
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
    setPushing(true)
    const toPush = lessons.filter((l) => l.status === 'draft' || l.status === 'updated')
    const count = toPush.length
    const { error: e1 } = await supabase
      .from('training_modules')
      .update({ status: 'published' })
      .in('status', ['draft', 'updated'])
    if (e1) { setError(e1.message); setPushing(false); return }
    await supabase.from('training_push_log').insert({
      pushed_by: user?.email || SUPER_ADMIN_EMAIL,
      lessons_pushed: count,
      notes: null,
    })
    setPushing(false)
    setConfirmPush(false)
    invalidate()
  }

  async function saveLesson(form) {
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
    if (form.id) {
      const prev = lessons
      setLessons((ls) => ls.map((l) => (l.id === form.id ? { ...l, ...payload } : l)))
      const { error: e } = await supabase.from('training_modules').update(payload).eq('id', form.id)
      if (e) { setError(e.message); setLessons(prev); return false }
    } else {
      const { data, error: e } = await supabase.from('training_modules').insert(payload).select().single()
      if (e) { setError(e.message); return false }
      setLessons((ls) => [...ls, data])
    }
    return true
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
            <h1 className="text-xl font-bold text-white">Training — TC Certification</h1>
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
          <p className="mb-3 text-xs text-slate-500">These are the horizontal tabs practices see. Rename or reorder them — lessons are grouped under their module.</p>
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
            {groups.length === 0 && <p className="text-sm text-slate-500">No module tabs yet — add one.</p>}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3 w-16">Order</th>
                  <th className="px-3 py-3">Module</th>
                  <th className="px-3 py-3">Title</th>
                  <th className="px-3 py-3">Description</th>
                  <th className="px-3 py-3 w-20">Min</th>
                  <th className="px-3 py-3">Video</th>
                  <th className="px-3 py-3 w-40">Status</th>
                  <th className="px-3 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700">
                {rows.map((l, i) => {
                  const meta = statusMeta(l.status)
                  return (
                    <tr key={l.id} className={i % 2 ? 'bg-surface-800/30' : ''}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <span className="w-5 text-slate-500">{l.order_index}</span>
                          <div className="flex flex-col">
                            <button onClick={() => reorder(l, -1)} disabled={i === 0 || busyId === l.id} className="text-slate-500 hover:text-slate-200 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                            <button onClick={() => reorder(l, 1)} disabled={i === rows.length - 1 || busyId === l.id} className="text-slate-500 hover:text-slate-200 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap">{groupName(l.module_group)}</td>
                      <td className="px-3 py-2.5 min-w-[200px]">
                        <InlineEdit value={l.title} onSave={(v) => patchLesson(l.id, { title: v }, { markUpdated: true })} className="font-medium text-slate-100" />
                      </td>
                      <td className="px-3 py-2.5 min-w-[220px]">
                        <InlineEdit value={l.description} textarea placeholder="Add description…" onSave={(v) => patchLesson(l.id, { description: v }, { markUpdated: true })} className="text-slate-400" />
                      </td>
                      <td className="px-3 py-2.5">
                        <InlineEdit value={String(minsFromSec(l.duration))} number onSave={(v) => patchLesson(l.id, { duration: (Number(v) || 0) * 60 }, { markUpdated: true })} className="text-slate-300" />
                      </td>
                      <td className="px-3 py-2.5 min-w-[160px]">
                        {l.video_url ? (
                          <a href={l.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-300 hover:text-primary-200 truncate max-w-[200px]">
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{l.video_url}</span>
                          </a>
                        ) : (
                          <InlineEdit value="" placeholder="No video" onSave={(v) => patchLesson(l.id, { video_url: v.trim() || null }, { markUpdated: true })} className="text-slate-500 italic" />
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => toggleStatus(l)} title="Toggle publish/draft">
                          <Badge className={meta.cls}>{meta.label}</Badge>
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setEditing(l)} className="rounded-md border border-surface-700 bg-surface-800 p-1.5 text-slate-300 hover:bg-surface-700" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => removeLesson(l)} disabled={busyId === l.id} className="rounded-md border border-surface-700 bg-surface-800 p-1.5 text-rose-300 hover:bg-surface-700 disabled:opacity-40" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-12 text-center text-slate-400">No lessons match the filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <LessonModal
          lesson={editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSave={async (form) => { const ok = await saveLesson(form); if (ok) setEditing(null) }}
        />
      )}

      {confirmPush && (
        <Modal title="Push updates" onClose={() => setConfirmPush(false)} maxWidth="max-w-md" footer={
          <>
            <button onClick={() => setConfirmPush(false)} className="btn-ghost">Cancel</button>
            <button onClick={doPush} disabled={pushing} className="btn-primary">
              {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Confirm Push
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
function InlineEdit({ value, onSave, className = '', placeholder = '', textarea = false, number = false }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value ?? '')
  useEffect(() => { setVal(value ?? '') }, [value]) // eslint-disable-line react-hooks/set-state-in-effect

  function commit() {
    setEditing(false)
    if ((val ?? '') !== (value ?? '')) onSave(val)
  }
  if (editing) {
    const common = {
      autoFocus: true,
      value: val,
      onChange: (e) => setVal(e.target.value),
      onBlur: commit,
      className: 'input w-full !py-1 !text-sm',
    }
    if (textarea) return <textarea {...common} rows={2} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
    return <input {...common} type={number ? 'number' : 'text'} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
  }
  return (
    <button onClick={() => setEditing(true)} className={`block w-full cursor-text truncate text-left hover:underline decoration-dotted ${className}`} title="Click to edit">
      {(value ?? '') === '' ? <span className="text-slate-600">{placeholder || '—'}</span> : value}
    </button>
  )
}

function LessonModal({ lesson, groups = [], onClose, onSave }) {
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
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    if (!form.title.trim()) return
    setBusy(true)
    await onSave(form)
    setBusy(false)
  }

  return (
    <Modal title={isNew ? 'Add Lesson' : 'Edit Lesson'} onClose={onClose} maxWidth="max-w-lg" footer={
      <>
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={submit} disabled={busy || !form.title.trim()} className="btn-primary">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
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
