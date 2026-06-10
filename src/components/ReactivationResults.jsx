import { useMemo, useState } from 'react'
import { Megaphone, ArrowLeft, Download, Loader2, RotateCcw, Trash2, Check, X, Clock, Pencil } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../lib/analytics'
import { treatmentLabel } from '../lib/treatments'
import {
  useReactivationCampaigns,
  useCampaignEnrollments,
  useUpdateEnrollmentNote,
  useToggleEnrollmentReopened,
  useRemoveEnrollment,
  isMutating,
} from '../lib/queries'

const STATUS_PILL = {
  draft: 'bg-slate-500/15 text-slate-400', scheduled: 'bg-sky-500/15 text-sky-300',
  active: 'bg-emerald-500/15 text-emerald-300', paused: 'bg-amber-500/15 text-amber-300', completed: 'bg-slate-500/15 text-slate-400',
}
const STEP_DAYS = [1, 4, 10] // Msg 1 / 2 / 3 day offsets
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ', ')
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export default function ReactivationResults() {
  const { practiceId } = useAuth()
  const { data: campaigns = [], isLoading } = useReactivationCampaigns(practiceId)
  const [openId, setOpenId] = useState(null)
  const open = campaigns.find((c) => c.id === openId)

  if (open) return <CampaignDetail campaign={open} onBack={() => setOpenId(null)} />

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight text-gray-900">Reactivation Campaigns</h2>
        <p className="mt-0.5 text-[13px] text-gray-500">Every one-off blast you've launched, with live results.</p>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-500">
          No reactivation campaigns yet. Launch one with the "Reactivation Campaign" button.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {campaigns.map((c) => {
            const targeted = c.total_recipients || 0
            const totalMsgs = targeted * 3
            const replyRate = targeted ? Math.round(((c.replies_count || 0) / targeted) * 100) : 0
            return (
              <button key={c.id} onClick={() => setOpenId(c.id)} className="rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-primary/40 hover:shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Megaphone className="h-4 w-4 shrink-0 text-primary-500" />
                    <span className="truncate text-sm font-semibold text-gray-900">{c.campaign_name || 'Reactivation campaign'}</span>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[c.status] || STATUS_PILL.draft}`}>{c.status}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {c.launched_at || c.started_at
                    ? `Launched ${fmtDate(c.launched_at || c.started_at)}`
                    : `Created ${fmtDate(c.created_at)}`}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Patients" value={targeted} />
                  <Stat label="Sent" value={`${c.messages_sent || 0}/${totalMsgs}`} />
                  <Stat label="Replies" value={`${c.replies_count || 0} · ${replyRate}%`} />
                  <Stat label="Reopened" value={c.cases_reopened || 0} />
                  <Stat label="Recovered" value={formatMoney(c.recovered_estimate || 0)} span={2} />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, span }) {
  return (
    <div className={`rounded-lg bg-gray-50 px-2 py-1.5 ${span === 2 ? 'col-span-2' : ''}`}>
      <p className="text-sm font-semibold text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
    </div>
  )
}

function MsgStatus({ status, sentAt, scheduledAt }) {
  if (status === 'sent') return <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> {fmtDateTime(sentAt) || 'Sent'}</span>
  if (status === 'replied') return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><Check className="h-3 w-3" /> Replied</span>
  if (status === 'failed') return <span className="inline-flex items-center gap-1 text-xs text-rose-600"><X className="h-3 w-3" /> Failed</span>
  return <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Clock className="h-3 w-3" /> {scheduledAt ? fmtDate(scheduledAt) : 'Pending'}</span>
}

function CampaignDetail({ campaign, onBack }) {
  const { data: rows = [], isLoading } = useCampaignEnrollments(campaign.id)
  const updateNoteMutation = useUpdateEnrollmentNote()
  const toggleReopenedMutation = useToggleEnrollmentReopened()
  const removeMutation = useRemoveEnrollment()
  const [editingNote, setEditingNote] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')

  const launched = campaign.launched_at || campaign.started_at
  const minuteInterval = Number(campaign.step_interval_minutes) || 0
  const schedFor = (i) => {
    if (!launched) return null
    if (minuteInterval > 0) return new Date(new Date(launched).getTime() + i * minuteInterval * 60_000)
    return new Date(new Date(launched).getTime() + (STEP_DAYS[i] - 1) * 86400000)
  }
  const schedLabel = (i) => {
    if (!launched) return 'Pending'
    if (minuteInterval > 0) {
      const t = schedFor(i)
      return i === 0 ? fmtDateTime(t) : `+${i * minuteInterval}m · ${fmtDateTime(t)}`
    }
    return fmtDate(schedFor(i))
  }

  const stats = useMemo(() => {
    const sent = rows.reduce((s, r) => s + ['msg_1_status', 'msg_2_status', 'msg_3_status'].filter((k) => r[k] === 'sent').length, 0)
    const replies = rows.filter((r) => r.replied || r.status === 'replied').length
    const reopened = rows.filter((r) => r.reopened).length
    const recovered = rows.filter((r) => r.reopened).reduce((s, r) => s + (Number(r.case_value ?? r.consult?.case_value) || 0), 0)
    return { patients: rows.length, sent, total: rows.length * 3, replies, reopened, recovered }
  }, [rows])

  function saveNote(r) {
    updateNoteMutation.mutate(
      { enrollmentId: r.id, campaignId: campaign.id, practiceId: campaign.practice_id, notes: noteDraft },
      { onSuccess: () => setEditingNote(null) },
    )
  }
  function toggleReopened(r) {
    toggleReopenedMutation.mutate({ enrollment: r, campaign })
  }
  function remove(r) {
    if (!confirm(`Remove ${r.patient_first} ${r.patient_last} from this campaign? They'll stop receiving messages.`)) return
    removeMutation.mutate({ enrollmentId: r.id, campaign })
  }

  function exportCsv() {
    const head = ['Name', 'Treatment', 'TX Plan Date', 'Phone', 'Email', 'Msg 1', 'Msg 2', 'Msg 3', 'Replied', 'Reopened', 'Notes']
    const lines = rows.map((r) => [
      `${r.patient_first || ''} ${r.patient_last || ''}`.trim(), treatmentLabel(r.treatment_type), r.tx_plan_date || '',
      r.patient_phone || '', r.patient_email || '', r.msg_1_status, r.msg_2_status, r.msg_3_status,
      r.replied ? 'yes' : 'no', r.reopened ? 'yes' : 'no', r.notes || '',
    ])
    const csv = [head, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `${(campaign.campaign_name || 'campaign').replace(/[^a-z0-9]+/gi, '-')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100"><ArrowLeft className="h-4 w-4" /></button>
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight text-gray-900">{campaign.campaign_name}</h2>
            <p className="text-xs text-gray-500">
              {launched ? `Launched ${fmtDate(launched)}` : `Created ${fmtDate(campaign.created_at)}`} · <span className="capitalize">{campaign.status}</span>
            </p>
          </div>
        </div>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-gray-600 transition hover:bg-gray-50"><Download className="h-3.5 w-3.5" /> Export CSV</button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Patients" value={stats.patients} />
        <Stat label="Messages sent" value={`${stats.sent}/${stats.total}`} />
        <Stat label="Replies" value={`${stats.replies} · ${stats.patients ? Math.round((stats.replies / stats.patients) * 100) : 0}%`} />
        <Stat label="Cases reopened" value={stats.reopened} />
        <Stat label="Recovered" value={formatMoney(stats.recovered)} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Treatment</th>
                <th className="px-3 py-2">{minuteInterval ? 'Email 1' : 'Msg 1 · D1'}</th>
                <th className="px-3 py-2">{minuteInterval ? `Email 2 (+${minuteInterval}m)` : 'Msg 2 · D4'}</th>
                <th className="px-3 py-2">{minuteInterval ? `Email 3 (+${minuteInterval * 2}m)` : 'Msg 3 · D10'}</th>
                <th className="px-3 py-2">Notes</th><th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const rowBusy = isMutating(toggleReopenedMutation, (v) => v.enrollment?.id === r.id)
                  || isMutating(removeMutation, (v) => v.enrollmentId === r.id)
                  || isMutating(updateNoteMutation, (v) => v.enrollmentId === r.id)
                return (
                <tr key={r.id} className={r.reopened ? 'bg-emerald-50/50' : ''}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{r.patient_first} {r.patient_last}</p>
                    <p className="text-xs text-gray-400">{r.patient_phone || r.patient_email || ''}</p>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{treatmentLabel(r.treatment_type)}</td>
                  <td className="px-3 py-2"><MsgStatus status={r.replied ? 'replied' : r.msg_1_status} sentAt={r.msg_1_sent_at} scheduledAt={schedFor(0)} /></td>
                  <td className="px-3 py-2"><MsgStatus status={r.replied ? 'replied' : r.msg_2_status} sentAt={r.msg_2_sent_at} scheduledAt={schedFor(1)} /></td>
                  <td className="px-3 py-2"><MsgStatus status={r.replied ? 'replied' : r.msg_3_status} sentAt={r.msg_3_sent_at} scheduledAt={schedFor(2)} /></td>
                  <td className="px-3 py-2 max-w-[180px]">
                    {editingNote === r.id ? (
                      <input
                        autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                        onBlur={() => saveNote(r)} onKeyDown={(e) => e.key === 'Enter' && saveNote(r)}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-xs" placeholder="Add a note…"
                      />
                    ) : (
                      <button onClick={() => { setEditingNote(r.id); setNoteDraft(r.notes || '') }} className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary-600">
                        <Pencil className="h-3 w-3" /> {r.notes ? <span className="truncate">{r.notes}</span> : 'Add note'}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1" >
                      <button onClick={() => toggleReopened(r)} disabled={rowBusy} title={r.reopened ? 'Unmark reopened' : 'Mark as reopened'}
                        className={`rounded-md border px-2 py-1 text-xs transition ${r.reopened ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                        {rowBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => remove(r)} disabled={rowBusy} title="Remove from campaign" className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-50 hover:text-rose-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )})}
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">No patients in this campaign.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
