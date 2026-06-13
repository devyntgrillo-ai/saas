import { useState } from 'react'
import {
  Plug, Loader2, Building2, Calendar, Clock,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import SikkaPracticeLink from '../components/SikkaPracticeLink'
import PmsSyncApproval from '../components/PmsSyncApproval'
import { formatDateTime } from '../lib/consults'
import { useDisconnectPms, usePmsAppointmentCount } from '../lib/queries'

function labelFor(type) {
  if (!type) return 'PMS'
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function PMSIntegration() {
  const { practice, practiceId, refreshProfile } = useAuth()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const disconnectMutation = useDisconnectPms()
  const connected = Boolean(practice?.sikka_connected)
  const syncApproved = Boolean(practice?.pms_sync_approved_at)
  const lastSynced = practice?.pms_last_synced_at || practice?.pms_last_sync || null
  const { data: apptCount = 0 } = usePmsAppointmentCount(practiceId, connected && syncApproved)

  async function handleDisconnect() {
    try {
      await disconnectMutation.mutateAsync({ practiceId })
      await refreshProfile()
      setConfirmDisconnect(false)
    } catch { /* noop */ }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-base font-semibold text-white">PMS Integration</h2>
          <p className="mt-1 text-sm text-slate-400">
            Sync consult appointments from your practice management system via Sikka.
          </p>
        </div>
      </div>

      {!connected ? (
        <SikkaPracticeLink practiceId={practiceId} onLinked={() => refreshProfile()} />
      ) : (
        <div className="card p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary-400">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-white">{practice?.sikka_practice_id || labelFor(practice?.pms_type)}</p>
                <p className="inline-flex items-center gap-1.5 text-sm text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" /> Connected
                  {practice?.sikka_practice_id && (
                    <span className="text-slate-500">· Sikka {practice.sikka_practice_id}</span>
                  )}
                  <span className="text-slate-500">· last synced {lastSynced ? formatDateTime(lastSynced) : '—'}</span>
                </p>
              </div>
            </div>
            <button onClick={() => setConfirmDisconnect(true)} className="btn-ghost text-rose-300">Disconnect</button>
          </div>

          <PmsSyncApproval onApproved={() => refreshProfile()} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-4">
              <Calendar className="h-4 w-4 text-slate-400" />
              <p className="mt-2 text-2xl font-bold text-white">{apptCount}</p>
              <p className="text-xs text-slate-500">appointments synced</p>
            </div>
            <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-4">
              <Clock className="h-4 w-4 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-white">{lastSynced ? formatDateTime(lastSynced) : 'Not yet'}</p>
              <p className="text-xs text-slate-500">last sync</p>
            </div>
          </div>
        </div>
      )}

      {!connected && (
        <div className="card px-5 py-4 text-xs text-slate-500 leading-relaxed">
          <p className="font-medium text-slate-400">Haven&apos;t synced to Sikka yet?</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            <li>
              Go to CaseLift on the Sikka marketplace:{' '}
              <a
                href="https://www.sikkasoft.com/CaseLift"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-300 hover:text-primary-200 underline underline-offset-2"
              >
                sikkasoft.com/CaseLift
              </a>
            </li>
            <li>Register for Sikka or log in with your existing Sikka account.</li>
            <li>Follow Sikka&apos;s instructions to download the Sikka Practice Utility (SPU) and connect it to your PMS.</li>
            <li>
              After your first sync completes, open the SPU → <strong className="text-slate-400">Settings → Account Details</strong>,
              copy your <strong className="text-slate-400">Master Customer ID</strong>, and enter it above to link your practice in CaseLift.
            </li>
          </ol>
        </div>
      )}

      {confirmDisconnect && (
        <Modal title="Disconnect PMS?" onClose={() => setConfirmDisconnect(false)} footer={
          <>
            <button onClick={() => setConfirmDisconnect(false)} className="btn-ghost">Cancel</button>
            <button onClick={handleDisconnect} disabled={disconnectMutation.isPending} className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold !text-white transition hover:bg-rose-500 disabled:opacity-50">
              {disconnectMutation.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Disconnect'}
            </button>
          </>
        }>
          <p className="text-sm text-slate-400">
            Appointment syncing will stop. Your existing consults and recordings are kept.
          </p>
        </Modal>
      )}
    </div>
  )
}
