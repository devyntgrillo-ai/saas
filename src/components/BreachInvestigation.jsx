import { useState } from 'react'
import { AlertTriangle, Search, Download, Loader2 } from 'lucide-react'
import { runBreachInvestigation } from '../lib/queries'
import { formatDateTime } from '../lib/consults'

const ACTION_LABELS = {
  'consult.viewed': 'Viewed consult',
  'patient.accessed': 'Accessed patient record',
  'message.sent': 'Sent patient message',
  'conversation.viewed': 'Viewed conversation',
  'consult.analyzed': 'Analyzed consult',
}

// RFC-4180-ish CSV cell: wrap in quotes and double any inner quotes.
const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(rows) {
  const headers = [
    'Timestamp', 'Action', 'Accessed by', 'Practice', 'Practice email', 'Practice phone',
    'Patient', 'Patient phone', 'Patient email', 'IP address',
  ]
  const lines = rows.map((r) =>
    [
      r.created_at, r.action, r.user_email, r.practice_name, r.practice_email, r.practice_phone,
      r.patient_name, r.patient_phone, r.patient_email, r.ip_address,
    ]
      .map(csvCell)
      .join(',')
  )
  return [headers.join(','), ...lines].join('\n')
}

export default function BreachInvestigation() {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ran, setRan] = useState(false)

  async function run() {
    setError('')
    if (!start || !end) {
      setError('Enter both a breach window start and end.')
      return
    }
    const startISO = new Date(start).toISOString()
    const endISO = new Date(end).toISOString()
    if (startISO >= endISO) {
      setError('The window start must be before the window end.')
      return
    }
    setLoading(true)
    try {
      const data = await runBreachInvestigation(startISO, endISO)
      setRows(data)
      setRan(true)
    } catch (e) {
      // Surface the real error (this is a super-admin diagnostic tool).
      const detail = [e?.message, e?.details, e?.hint].filter(Boolean).join(' · ')
      setError(detail ? `${detail}${e?.code ? ` [${e.code}]` : ''}` : 'Investigation failed.')
    } finally {
      setLoading(false)
    }
  }

  function exportCsv() {
    if (!rows.length) return
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `breach-investigation-${start || 'window'}.csv`.replace(/[:]/g, '-')
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <section className="card border border-red-300 bg-red-50/60 p-5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div>
          <h3 className="text-sm font-bold text-red-900">HIPAA Breach Investigation Tool</h3>
          <p className="mt-1 text-xs leading-relaxed text-red-800">
            Identifies patients whose PHI may have been accessed during a specified time window.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Breach window start
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100 focus:border-primary focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Breach window end
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-100 focus:border-primary focus:outline-none"
          />
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Run Investigation
        </button>
        {ran && rows.length > 0 && (
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-red-400 px-4 py-2 text-sm font-semibold text-red-800 transition hover:bg-red-100"
          >
            <Download className="h-4 w-4" />
            Export to CSV
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}

      {ran && !loading && !error && (
        <p className="mt-3 text-xs text-slate-600">
          {rows.length} PHI-access {rows.length === 1 ? 'event' : 'events'} in window.
        </p>
      )}

      {rows.length > 0 && (
        <div className="card mt-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left">
              <thead>
                <tr className="border-b border-surface-700 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Accessed by</th>
                  <th className="px-4 py-3">Practice</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">IP address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700">
                {rows.map((r, i) => (
                  <tr key={`${r.created_at}-${r.resource_id}-${i}`} className="align-top text-sm">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-200">{formatDateTime(r.created_at)}</td>
                    <td className="px-4 py-3 text-slate-200">{ACTION_LABELS[r.action] || r.action || '-'}</td>
                    <td className="px-4 py-3 text-slate-200">{r.user_email || '-'}</td>
                    <td className="px-4 py-3 text-slate-300">
                      <div className="font-medium text-slate-100">{r.practice_name || '-'}</div>
                      {r.practice_email && <div className="text-xs text-slate-400">{r.practice_email}</div>}
                      {r.practice_phone && <div className="text-xs text-slate-400">{r.practice_phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <div className="font-medium text-slate-100">{r.patient_name || '-'}</div>
                      {r.patient_phone && <div className="text-xs text-slate-400">{r.patient_phone}</div>}
                      {r.patient_email && <div className="text-xs text-slate-400">{r.patient_email}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-300">{r.ip_address || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
