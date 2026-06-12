import { useEffect, useState } from 'react'
import { Loader2, Check, Mail, MessageSquare, Bell, Send, Info, Smartphone, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  useMyNotificationSettings,
  useUpdateMyNotificationSettings,
  useMyDevices,
  useRemoveDevice,
  useSendTestDigest,
} from '../lib/queries'

// Notification preferences are PER USER (stored in user_notification_settings and
// shared with the mobile app via the same row). Channels are email / sms / push;
// Slack stays CaseLift-internal and is not user-configurable.
const EVENTS = [
  { key: 'patient_replied', label: 'Patient Replied', tip: 'Get notified when a patient responds to a CaseLift follow-up sequence', def: { email: true, sms: true, push: true } },
  { key: 'case_converted', label: 'Case Converted', tip: 'Get notified when a treatment plan is marked as won or accepted', def: { email: true, sms: true, push: true } },
  { key: 'daily_calls_due', label: 'Daily Calls Due', tip: 'Get a daily list of patients scheduled for a manual follow-up call today', def: { email: true, sms: false, push: true } },
  { key: 'low_recording_rate', label: 'Low Recording Reminder', tip: 'A reminder when several implant consults pass in a row without being recorded', def: { email: true, sms: false, push: true }, noSms: true },
]
const CHANNELS = ['email', 'sms', 'push']

function defaultPrefs() {
  const out = {}
  EVENTS.forEach((e) => { out[e.key] = { ...e.def } })
  return out
}

function InfoTip({ text }) {
  return (
    <span className="group relative inline-flex align-middle">
      <Info className="h-3.5 w-3.5 cursor-help text-slate-500" />
      <span
        style={{ backgroundColor: '#1e293b', color: '#ffffff' }}
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-lg px-3 py-2 text-[12px] font-normal normal-case leading-snug tracking-normal shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  )
}

function Section({ title, tip, children }) {
  return (
    <div className="card p-6">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}{tip && <InfoTip text={tip} />}
      </h2>
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Switch({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? 'bg-primary' : 'bg-surface-700'}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

const CHANNEL_ICON = { email: Mail, sms: MessageSquare, push: Bell }

export default function NotificationSettings() {
  const { user, practice } = useAuth()
  const userId = user?.id
  const { data: settings } = useMyNotificationSettings(userId)
  const { data: devices = [] } = useMyDevices(userId)
  const updateSettings = useUpdateMyNotificationSettings()
  const removeDevice = useRemoveDevice()
  const testDigestMutation = useSendTestDigest()
  const [prefs, setPrefs] = useState(defaultPrefs())
  const [form, setForm] = useState({})
  const [flash, setFlash] = useState('')

  useEffect(() => {
    if (!userId) return
    const s = settings || {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs({ ...defaultPrefs(), ...(s.notification_prefs || {}) })
    setForm({
      notify_push: s.notify_push ?? true,
      notify_email_address: s.notify_email_address || user?.email || '',
      notify_sms_number: s.notify_sms_number || '',
      recording_reminders_enabled: s.recording_reminders_enabled ?? false,
      recording_reminder_minutes: s.recording_reminder_minutes ?? 5,
      recording_reminder_channel: s.recording_reminder_channel || 'push',
      weekly_digest_enabled: s.weekly_digest_enabled ?? true,
      weekly_digest_day: s.weekly_digest_day || 'monday',
      weekly_digest_time: s.weekly_digest_time || '9am',
    })
  }, [settings, userId, user?.email])

  function save(patch, msg = 'Saved') {
    if (!userId || updateSettings.isPending) return
    updateSettings.mutate(
      { userId, practiceId: practice?.id ?? null, patch },
      {
        onSuccess: () => { setFlash(msg); setTimeout(() => setFlash(''), 2000) },
      },
    )
  }

  const saving = updateSettings.isPending
  const setF = (k, v) => { setForm((f) => ({ ...f, [k]: v })); save({ [k]: v }) }

  function toggleCell(eventKey, channel) {
    const next = { ...prefs, [eventKey]: { ...prefs[eventKey], [channel]: !prefs[eventKey]?.[channel] } }
    setPrefs(next)
    save({ notification_prefs: next }, 'Preferences updated')
  }

  function sendTestDigest() {
    if (!practice?.id || testDigestMutation.isPending) return
    testDigestMutation.mutate(
      { practiceId: practice.id },
      { onSuccess: () => { setFlash('Test digest sent'); setTimeout(() => setFlash(''), 2500) } },
    )
  }
  const testing = testDigestMutation.isPending

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">My Notifications</h2>
          <p className="text-sm text-slate-400">Choose how and when you're alerted. These settings are yours and sync to the CaseLift mobile app.</p>
        </div>
        {flash && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300"><Check className="h-3.5 w-3.5" /> {flash}</span>}
        {saving && !flash && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
      </div>

      {/* CHANNELS / CONTACT */}
      <Section title="Channels">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-200"><Mail className="h-4 w-4 text-slate-400" /> Email</div>
            <input value={form.notify_email_address || ''} onChange={(e) => setForm((f) => ({ ...f, notify_email_address: e.target.value }))}
              onBlur={(e) => save({ notify_email_address: e.target.value || null })} placeholder="you@practice.com" className="input max-w-[260px]" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-700 pt-3">
            <div className="flex items-center gap-2 text-sm text-slate-200"><MessageSquare className="h-4 w-4 text-slate-400" /> SMS</div>
            <input value={form.notify_sms_number || ''} onChange={(e) => setForm((f) => ({ ...f, notify_sms_number: e.target.value }))}
              onBlur={(e) => save({ notify_sms_number: e.target.value || null })} placeholder="(512) 555-0142" className="input max-w-[260px]" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-700 pt-3">
            <div className="flex items-center gap-2 text-sm text-slate-200"><Bell className="h-4 w-4 text-slate-400" /> Push (mobile app)</div>
            <Switch checked={Boolean(form.notify_push)} onChange={(v) => setF('notify_push', v)} />
          </div>
          {/* Registered push devices (from the mobile app) */}
          {devices.length > 0 && (
            <div className="border-t border-surface-700 pt-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Registered devices</p>
              <ul className="space-y-2">
                {devices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 text-sm text-slate-300">
                    <span className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-slate-400" /> {d.platform || 'device'} · {String(d.expo_push_token).replace('ExponentPushToken[', '…').slice(0, 14)}</span>
                    <button onClick={() => removeDevice.mutate({ deviceId: d.id, userId })} className="text-slate-500 hover:text-red-400" title="Remove device">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* PREFERENCES MATRIX */}
      <Section title="Preferences">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 text-left font-semibold">Event</th>
                {CHANNELS.map((ch) => (
                  <th key={ch} className="pb-2 text-center font-semibold capitalize">{ch}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {EVENTS.map((e) => (
                <tr key={e.key}>
                  <td className="py-2.5 text-slate-200">
                    <span className="inline-flex items-center gap-1.5">{e.label}<InfoTip text={e.tip} /></span>
                  </td>
                  {CHANNELS.map((ch) => {
                    const disabled = e.noSms && ch === 'sms'
                    const Icon = CHANNEL_ICON[ch]
                    return (
                      <td key={ch} className="py-2.5 text-center">
                        {disabled
                          ? <span className="text-slate-600">—</span>
                          : <span className="inline-flex"><Switch checked={Boolean(prefs[e.key]?.[ch])} onChange={() => toggleCell(e.key, ch)} /></span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">Push goes to your registered mobile devices. Slack alerts route only to CaseLift's internal channel.</p>
      </Section>

      {/* RECORDING REMINDERS */}
      <Section title="Pre-Consult Recording Reminder" tip="Sends a reminder before a scheduled consult appointment to make sure you record it">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-200">Remind me to record before consults</p>
            <p className="text-xs text-slate-500">Only fires for appointments marked as consults.</p>
          </div>
          <Switch checked={Boolean(form.recording_reminders_enabled)} onChange={(v) => setF('recording_reminders_enabled', v)} />
        </div>
        {form.recording_reminders_enabled && (
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="text-sm text-slate-400">Timing
              <select value={form.recording_reminder_minutes} onChange={(e) => setF('recording_reminder_minutes', Number(e.target.value))} className="input mt-1">
                {[2, 5, 10, 15].map((n) => <option key={n} value={n}>{n} min before</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-400">Channel
              <select value={form.recording_reminder_channel} onChange={(e) => setF('recording_reminder_channel', e.target.value)} className="input mt-1">
                <option value="push">Push</option><option value="sms">SMS</option><option value="both">Both</option>
              </select>
            </label>
          </div>
        )}
      </Section>

      {/* WEEKLY DIGEST */}
      <Section title="Weekly digest">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-slate-200">Send me a weekly performance digest</p>
          <Switch checked={Boolean(form.weekly_digest_enabled)} onChange={(v) => setF('weekly_digest_enabled', v)} />
        </div>
        {form.weekly_digest_enabled && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm text-slate-400">Send day
              <select value={form.weekly_digest_day} onChange={(e) => setF('weekly_digest_day', e.target.value)} className="input mt-1">
                <option value="monday">Monday</option><option value="friday">Friday</option>
              </select>
            </label>
            <label className="text-sm text-slate-400">Send time
              <select value={form.weekly_digest_time} onChange={(e) => setF('weekly_digest_time', e.target.value)} className="input mt-1">
                <option value="8am">8am</option><option value="9am">9am</option><option value="10am">10am</option>
              </select>
            </label>
            <div className="sm:col-span-2">
              <button onClick={sendTestDigest} disabled={testing} className="btn-secondary">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test digest
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
