import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, UserCog, Ban, Loader2, Check, MessageSquare, Plug, Search, RefreshCw, Link2 } from 'lucide-react'
import Modal from '../../components/Modal'
import { useAdmin } from '../../context/AdminContext'
import { smsStatusMeta } from '../../lib/admin'
import { statusMeta as subStatusMeta } from '../../lib/billing'
import { timeAgo } from '../../lib/consults'
import {
  useAdminPracticeConsults,
  useAdminPracticePms,
  useForceCancelPractice,
  useSaveSikkaConfig,
  useUpdatePracticeAdminNotes,
  queryKeys,
} from '../../lib/queries'
import {
  searchSikkaPractice, testSyncForPractice, fetchUnlinkedRegistrations, linkRegistration,
} from '../../lib/pms'
import { StatCard, Table, Badge, money } from '../../components/admin/ui'

const ADMIN_PMS_TYPES = ['dentrix', 'eaglesoft', 'curve', 'open_dental', 'carestream', 'other']

// Admin-only Sikka linking for a practice (practices never see this).
function PmsConfigSection({ practiceId }) {
  const queryClient = useQueryClient()
  const saveSikka = useSaveSikkaConfig()
  const { data, refetch } = useAdminPracticePms(practiceId)
  const [row, setRow] = useState(null)
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [testing, setTesting] = useState(false)
  const [flash, setFlash] = useState('')
  const regs = data?.regs || []

  useEffect(() => {
    if (data?.row) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRow(data.row)
    }
  }, [data])

  const reload = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.practicePms(practiceId) })

  function note(m) { setFlash(m); setTimeout(() => setFlash(''), 4000) }
  const set = (k, v) => setRow((r) => ({ ...r, [k]: v }))

  async function save() {
    try {
      await saveSikka.mutateAsync({ practiceId, config: row })
      note('PMS configuration saved.')
    } catch (e) { note(e.message || 'Save failed.') }
  }
  // OAuth model: list the offices this practice's Sikka token is authorized for.
  async function search() {
    setSearching(true); setResults(null)
    try { setResults(await searchSikkaPractice(practiceId)) }
    catch (e) { note(e.message || 'Could not load Sikka offices.'); setResults([]) }
    finally { setSearching(false) }
  }
  async function testSync() {
    setTesting(true)
    try { const r = await testSyncForPractice(practiceId); note(`Sync ran - ${r.synced ?? 0} appointment(s) returned.`); reload() }
    catch (e) { note(e.message || 'Sync failed.') } finally { setTesting(false) }
  }
  async function link(reg) {
    await linkRegistration(reg.id, practiceId, reg.sikka_practice_id)
    note(`Linked ${reg.practice_name || reg.sikka_practice_id} to this practice.`)
    reload()
  }

  if (!row) return null
  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Plug className="h-4 w-4 text-primary-400" /> PMS Configuration <span className="text-xs font-normal text-slate-500">(admin only)</span></h2>
        {flash && <span className="rounded-lg border border-surface-700 bg-surface-800 px-2.5 py-1 text-xs text-slate-300">{flash}</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Sikka Practice ID</label>
          <input className="input" value={row.sikka_practice_id || ''} onChange={(e) => set('sikka_practice_id', e.target.value)} placeholder="SIK-XXXX-0000" />
        </div>
        <div>
          <label className="label">PMS Type</label>
          <select className="input" value={row.pms_type || ''} onChange={(e) => set('pms_type', e.target.value)}>
            <option value="">-</option>
            {ADMIN_PMS_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-[200px] flex-1 text-xs text-slate-500">
          The practice connects via OAuth (Settings → Integrations → Connect to Sikka). Load the offices their token is authorized for, then pick the office_id to sync.
        </p>
        <button onClick={search} disabled={searching} className="btn-ghost">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Load Sikka offices
        </button>
        <button onClick={testSync} disabled={testing} className="btn-ghost">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Test Sync
        </button>
        <button onClick={save} disabled={saveSikka.isPending} className="btn-primary">
          {saveSikka.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>

      {results && (
        <div className="rounded-lg border border-surface-700 bg-surface-800/50 p-2">
          {results.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-slate-500">No authorized Sikka offices found for this practice.</p>
          ) : results.map((r) => (
            <button key={r.sikka_practice_id} onClick={() => { set('sikka_practice_id', r.sikka_practice_id); setResults(null) }}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm transition hover:bg-surface-700">
              <span><span className="text-slate-100">{r.name || r.sikka_practice_id}</span>{r.address && <span className="text-slate-500"> · {r.address}</span>}</span>
              <span className="font-mono text-xs text-slate-500">{r.sikka_practice_id}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-surface-700 pt-3">
        <label className="flex items-center gap-2.5 text-sm text-slate-200">
          <input type="checkbox" checked={Boolean(row.sikka_connected)} onChange={(e) => set('sikka_connected', e.target.checked)} className="h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary" />
          PMS Connected
        </label>
        <span className="text-xs text-slate-500">
          {row.pms_last_synced_at ? `Last synced ${timeAgo(row.pms_last_synced_at)}` : 'Never synced'}
        </span>
      </div>

      {regs.length > 0 && (
        <div className="border-t border-surface-700 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unlinked Sikka registrations</p>
          <div className="mt-2 space-y-1.5">
            {regs.map((reg) => (
              <div key={reg.id} className="flex items-center justify-between gap-3 rounded-md border border-surface-700 bg-surface-800/50 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-200">
                  {reg.practice_name || 'Unknown'} <span className="font-mono text-xs text-slate-500">· {reg.sikka_practice_id}</span>
                </span>
                <button onClick={() => link(reg)} className="shrink-0 rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-primary-300 transition hover:bg-surface-700">
                  <Link2 className="mr-1 inline h-3.5 w-3.5" />Link to this practice
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default function PracticeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, refresh, impersonatePractice } = useAdmin()
  const forceCancel = useForceCancelPractice()
  const [confirmCancel, setConfirmCancel] = useState(false)

  const practice = data.practices.find((p) => String(p.id) === String(id))
  const { data: consults, isLoading: consultsLoading } = useAdminPracticeConsults(practice?.id)

  if (!practice) {
    return (
      <div className="card px-6 py-16 text-center">
        <p className="text-sm text-slate-400">Practice not found.</p>
        <button onClick={() => navigate('/admin/practices')} className="btn-ghost mt-4">Back to practices</button>
      </div>
    )
  }

  const sms = smsStatusMeta(practice.sms_status)
  const subMeta = subStatusMeta(practice.subscription_status)
  // Recording rate = consults this month vs. ~22 working days (rough proxy).
  const recordingRate = Math.min(100, Math.round(((practice.consults_month || 0) / 22) * 100))

  async function handleForceCancel() {
    try {
      if (!String(practice.id).startsWith('demo-')) {
        await forceCancel.mutateAsync({ practiceId: practice.id })
        await refresh()
      }
      setConfirmCancel(false)
    } catch { /* noop */ }
  }

  return (
    <div className="space-y-8">
      <button onClick={() => navigate('/admin/practices')} className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> All practices
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-white">{practice.name}</h1>
            <Badge className={subMeta.classes}>{subMeta.label}</Badge>
          </div>
          <p className="text-sm text-slate-500">
            {practice.doctor ? `Dr. ${practice.doctor} · ` : ''}{practice.location || 'No location'}
            {practice.agency_name ? ` · ${practice.agency_name}` : ' · Direct'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => impersonatePractice(practice)} className="btn-ghost text-primary-300"><UserCog className="h-4 w-4" /> Impersonate</button>
          <button onClick={() => setConfirmCancel(true)} className="btn-ghost text-rose-300"><Ban className="h-4 w-4" /> Force cancel</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Days on platform" value={practice.days_on_platform} />
        <StatCard label="Consults this month" value={practice.consults_month} />
        <StatCard label="Production recovered" value={money(practice.recovered)} accent="text-emerald-300" />
        <StatCard label="Recording rate" value={`${recordingRate}%`} sub="consults vs. working days" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><MessageSquare className="h-4 w-4 text-slate-500" /> Twilio / SMS</h2>
          <p className="mt-3 text-sm">Status: <span className={sms.classes}>{sms.label}</span></p>
          <p className="mt-1 text-xs text-slate-500">Email + SMS follow-up channel for recovered consults.</p>
        </div>
        <div className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Plug className="h-4 w-4 text-slate-500" /> PMS connection</h2>
          <p className="mt-3 text-sm">Status: <span className="text-slate-300">{practice.sms_status === 'active' ? 'Connected' : 'Not connected'}</span></p>
          <p className="mt-1 text-xs text-slate-500">Auto-matches consults to scheduled appointments.</p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Recent consults</h2>
        {consultsLoading ? (
          <div className="card flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
        ) : (
          <Table
            head={['Date', 'Status', 'Primary objection']}
            rows={((consults || []).length ? consults : demoConsults(practice)).map((c) => [
              c.recording_date || (c.created_at ? new Date(c.created_at).toLocaleDateString() : '-'),
              <Badge>{c.status || 'analyzed'}</Badge>,
              c.primary_objection || '-',
            ])}
            empty="No consults recorded yet."
          />
        )}
      </section>

      <PmsConfigSection practiceId={practice.id} />

      <InternalNotes practice={practice} onSaved={refresh} />

      {confirmCancel && (
        <Modal title="Force cancel subscription?" onClose={() => setConfirmCancel(false)} footer={
          <>
            <button onClick={() => setConfirmCancel(false)} className="btn-ghost">Cancel</button>
            <button onClick={handleForceCancel} disabled={forceCancel.isPending} className="btn-primary inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-70">
              {forceCancel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Force cancel
            </button>
          </>
        }>
          <p className="text-sm text-slate-300">This immediately cancels {practice.name}'s subscription and revokes access. This cannot be undone from here.</p>
        </Modal>
      )}
    </div>
  )
}

function demoConsults(practice) {
  if (!practice.consults_month) return []
  return Array.from({ length: Math.min(5, practice.consults_month) }).map((_, i) => ({
    id: `demo-c-${i}`,
    created_at: new Date(Date.now() - i * 2 * 86400000).toISOString(),
    status: i % 3 === 0 ? 'recovered' : 'analyzed',
    primary_objection: ['Cost concern', 'Needs spouse approval', 'Wants to think it over', 'Timing', 'Comparing options'][i % 5],
  }))
}

function InternalNotes({ practice, onSaved }) {
  const updateNotes = useUpdatePracticeAdminNotes()
  const [value, setValue] = useState(practice.notes || '')
  const [savedAt, setSavedAt] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  function onChange(e) {
    setValue(e.target.value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!String(practice.id).startsWith('demo-')) {
        updateNotes.mutate(
          { practiceId: practice.id, notes: e.target.value },
          { onSuccess: () => { setSavedAt(new Date()); onSaved?.() } },
        )
      }
    }, 900)
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Internal notes</h2>
        <span className="text-xs text-slate-500">
          {updateNotes.isPending ? 'Saving…' : savedAt ? <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3 w-3" /> Saved {timeAgo(savedAt.toISOString())}</span> : 'Admin only'}
        </span>
      </div>
      <textarea value={value} onChange={onChange} placeholder="Private notes about this practice - auto-saves." className="input mt-3 min-h-[100px]" />
    </div>
  )
}
