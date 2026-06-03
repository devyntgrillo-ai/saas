import { useCallback, useEffect, useState } from 'react'
import {
  Plug, Download, Loader2, CheckCircle2, ArrowRight, ArrowLeft, Calendar, X, Building2, Clock,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { formatDateTime } from '../lib/consults'
import { savePmsType, fetchAppointmentCount, disconnectPms } from '../lib/pms'

// The practice only picks a PMS by name - everything routes through Sikka behind
// the scenes, so the practice never sees a Sikka ID or any API key.
const PMS_TYPES = [
  { value: 'dentrix', label: 'Dentrix' },
  { value: 'eaglesoft', label: 'Eaglesoft' },
  { value: 'curve', label: 'Curve' },
  { value: 'open_dental', label: 'Open Dental' },
  { value: 'carestream', label: 'Carestream' },
  { value: 'other', label: 'Other' },
]
const labelFor = (v) => PMS_TYPES.find((p) => p.value === v)?.label || 'your PMS'

// OS detection for the sync-app installer.
function detectOS() {
  const sig = `${navigator.userAgent || ''} ${navigator.platform || ''}`
  if (/mac|iphone|ipad|ipod|darwin/i.test(sig)) return 'mac'
  if (/win/i.test(sig)) return 'windows'
  return 'unknown'
}
const SYNC_APPS = { mac: 'caselift-sync-mac.dmg', windows: 'caselift-sync-windows.exe' }
function downloadApp(file) {
  const a = document.createElement('a')
  a.href = `/downloads/${file}`
  a.download = file
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ===========================================================================
// 3-step connection wizard (no Sikka ID - install an app, done).
// ===========================================================================
function PMSWizard({ practiceId, currentType, onClose, onDone }) {
  const { refreshProfile } = useAuth()
  const [step, setStep] = useState(1)
  const [pmsType, setPmsType] = useState(currentType || '')
  const [installed, setInstalled] = useState(false)
  const [showBoth, setShowBoth] = useState(false)
  const [firstSynced, setFirstSynced] = useState(false)

  // STEP 3: persist the chosen PMS, then poll for the first synced appointment.
  useEffect(() => {
    if (step !== 3) return
    let on = true
    savePmsType(practiceId, pmsType).then(() => refreshProfile?.()).catch(() => {})
    const poll = async () => {
      const count = await fetchAppointmentCount(practiceId)
      if (on && count > 0) { setFirstSynced(true); refreshProfile?.() }
    }
    poll()
    const t = setInterval(poll, 5000)
    return () => { on = false; clearInterval(t) }
  }, [step, practiceId, pmsType, refreshProfile])

  const label = labelFor(pmsType)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-700 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Plug className="h-4 w-4 text-primary-400" /> Connect your PMS
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Step {step} of 3</span>
            <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-surface-800 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-6">
          {/* STEP 1 - select PMS type */}
          {step === 1 && (
            <div>
              <h3 className="text-base font-semibold text-white">Which system does your practice use?</h3>
              <p className="mt-1 text-sm text-slate-400">We connect to all of these automatically.</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PMS_TYPES.map((p) => (
                  <button key={p.value} onClick={() => setPmsType(p.value)}
                    className={`rounded-lg border px-3 py-4 text-sm font-medium transition ${pmsType === p.value ? 'border-primary bg-primary/10 text-white' : 'border-surface-700 bg-surface-800/50 text-slate-300 hover:border-surface-600'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={() => setStep(2)} disabled={!pmsType} className="btn-primary">
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 - install the sync app */}
          {step === 2 && (
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary-400">
                <Download className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">Install the CaseLift sync app</h3>
              <p className="mt-1 text-sm text-slate-400">
                A small background app that connects {label} to CaseLift. Takes about 2 minutes.
              </p>
              <button type="button" className="btn-primary mt-4"
                onClick={() => {
                  const os = detectOS()
                  if (os === 'mac' || os === 'windows') downloadApp(SYNC_APPS[os])
                  else setShowBoth(true)
                }}>
                <Download className="h-4 w-4" /> Download sync app
              </button>
              {showBoth && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">Choose your OS:</span>
                  <a href="/downloads/caselift-sync-mac.dmg" download className="btn-ghost px-3 py-1.5 text-xs"><Download className="h-3.5 w-3.5" /> macOS</a>
                  <a href="/downloads/caselift-sync-windows.exe" download className="btn-ghost px-3 py-1.5 text-xs"><Download className="h-3.5 w-3.5" /> Windows</a>
                </div>
              )}
              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-surface-700 bg-surface-800/50 p-3 text-sm text-slate-200">
                <input type="checkbox" checked={installed} onChange={(e) => setInstalled(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary" />
                I've installed the sync app
              </label>
              <div className="mt-6 flex items-center justify-between">
                <button onClick={() => setStep(1)} className="btn-ghost"><ArrowLeft className="h-4 w-4" /> Back</button>
                <button onClick={() => setStep(3)} disabled={!installed} className="btn-primary">Continue <ArrowRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {/* STEP 3 - done / pending (polls for first sync) */}
          {step === 3 && (
            <div className="text-center">
              <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${firstSynced ? 'bg-emerald-500/15 text-emerald-400' : 'bg-primary/10 text-primary-300'}`}>
                {firstSynced ? <CheckCircle2 className="h-7 w-7" /> : <Loader2 className="h-7 w-7 animate-spin" />}
              </div>
              <h3 className="mt-4 text-lg font-bold text-white">
                {firstSynced ? "You're connected!" : "You're all set"}
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                {firstSynced
                  ? 'Your appointments are syncing. They now appear under Consults.'
                  : 'Appointments will sync automatically within 15 minutes. You can close this - they’ll appear under Consults as soon as the first sync runs.'}
              </p>
              <button onClick={() => { onDone?.(); onClose() }} className="btn-primary mt-6 w-full">Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// PMS Integration tab - wizard entry + practice-facing status (no Sikka).
// ===========================================================================
export default function PMSIntegration() {
  const { practice, practiceId, refreshProfile } = useAuth()
  const [wizard, setWizard] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [busy, setBusy] = useState(false)
  const [apptCount, setApptCount] = useState(0)

  const connected = Boolean(practice?.sikka_connected)
  const wizardComplete = connected || Boolean(practice?.pms_type)
  const lastSynced = practice?.pms_last_synced_at || practice?.pms_last_sync || null

  const load = useCallback(async () => {
    if (!practiceId || !wizardComplete) return
    setApptCount(await fetchAppointmentCount(practiceId))
  }, [practiceId, wizardComplete])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function handleDisconnect() {
    setBusy(true)
    try {
      await disconnectPms(practiceId)
      await refreshProfile()
      setConfirmDisconnect(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-base font-semibold text-white">PMS Integration</h2>
          <p className="mt-1 text-sm text-slate-400">Install the CaseLift sync app on your front-desk computer and your consult appointments appear automatically.</p>
        </div>
        {!wizardComplete && (
          <button onClick={() => setWizard(true)} className="btn-primary">
            <Plug className="h-4 w-4" /> Connect your PMS
          </button>
        )}
      </div>

      {wizardComplete ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary-400">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-white">{labelFor(practice?.pms_type)}</p>
                {connected ? (
                  <p className="inline-flex items-center gap-1.5 text-sm text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> Connected
                    <span className="text-slate-500">· last synced {lastSynced ? formatDateTime(lastSynced) : '-'}</span>
                  </p>
                ) : (
                  <p className="inline-flex items-center gap-1.5 text-sm text-amber-300">
                    <Clock className="h-3.5 w-3.5" /> Pending - your sync app is being configured
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setWizard(true)} className="btn-ghost">Reconnect</button>
              <button onClick={() => setConfirmDisconnect(true)} className="btn-ghost text-rose-300">Disconnect</button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      ) : (
        <div className="card px-6 py-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-800 text-slate-500">
            <Plug className="h-7 w-7" />
          </div>
          <p className="mt-4 text-sm font-semibold text-slate-200">No PMS connected</p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">
            Connect your practice management system so today's consult appointments appear automatically and the TC can record from the schedule.
          </p>
          <button onClick={() => setWizard(true)} className="btn-primary mt-4">
            <Plug className="h-4 w-4" /> Connect your PMS
          </button>
        </div>
      )}

      {wizard && (
        <PMSWizard
          practiceId={practiceId}
          currentType={practice?.pms_type}
          onClose={() => setWizard(false)}
          onDone={() => { refreshProfile(); load() }}
        />
      )}

      {confirmDisconnect && (
        <Modal title="Disconnect PMS?" onClose={() => setConfirmDisconnect(false)} footer={
          <>
            <button onClick={() => setConfirmDisconnect(false)} className="btn-ghost">Cancel</button>
            <button onClick={handleDisconnect} disabled={busy} className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold !text-white transition hover:bg-rose-500 disabled:opacity-50">
              {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Disconnect'}
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
