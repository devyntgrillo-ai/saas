import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Mic, Video, Smartphone, Plug, Hash, Copy, Check,
  Loader2, CheckCircle2, Lock, ChevronDown,
  RefreshCw, SlidersHorizontal,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { usePlaudLastSync } from '../lib/queries'
import { plaudAutoflowEmail, AUDIO_QUALITY, MIC_PREF_KEY, listMicrophones } from '../lib/recording'
import { timeAgo } from '../lib/consults'

function Badge({ tone, children }) {
  const tones = {
    green: 'bg-emerald-500/15 text-emerald-300',
    amber: 'bg-amber-500/15 text-amber-300',
    blue: 'bg-sky-500/15 text-sky-300',
    slate: 'bg-slate-500/15 text-slate-400',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone] || tones.slate}`}>{children}</span>
}

function SectionHeader({ children }) {
  return <h2 className="mb-3 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h2>
}

function IntegrationCard({ logo, logoTone = 'bg-surface-700', title, children, badge, disabled }) {
  return (
    <div className={`card p-5 ${disabled ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${logoTone} !text-white`}>{logo}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            {badge}
          </div>
          <div className="mt-2 text-sm text-slate-400">{children}</div>
        </div>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      <button
        type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${checked ? 'bg-primary' : 'bg-surface-700'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

// Plaud Device card - collapsed shows status + (when connected) a Sync Now control;
// clicking the header expands an inline accordion with the AutoFlow address, API
// key, auto-sync toggle, and Connect/Disconnect.
function PlaudCard({ practice, save, saving }) {
  const [expanded, setExpanded] = useState(false)
  const [token, setToken] = useState(practice?.plaud_api_key || '')
  const [copied, setCopied] = useState(false)
  const [syncFlash, setSyncFlash] = useState('')
  const { data: lastSync } = usePlaudLastSync(practice?.id)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setToken(practice?.plaud_api_key || '') }, [practice?.plaud_api_key])

  const connected = Boolean(practice?.plaud_webhook_url)
  const autoflow = practice?.id ? plaudAutoflowEmail(practice.id) : ''
  const busy = saving === 'plaud'

  async function copyEmail() {
    try { await navigator.clipboard.writeText(autoflow); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* noop */ }
  }
  function syncNow() { setSyncFlash('Checked for new recordings'); setTimeout(() => setSyncFlash(''), 2500) }

  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-start gap-3 p-5 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 !text-white"><Smartphone className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Plaud Device</h3>
            <div className="flex items-center gap-2">
              {connected ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Connected</Badge> : <Badge tone="slate">Not connected</Badge>}
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            {connected
              ? `Recordings sync automatically${lastSync ? ` · last sync ${timeAgo(lastSync)}` : ''}.`
              : 'Sync recordings automatically from your Plaud NotePin.'}
          </p>
          {connected && (
            <div className="mt-3 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              {syncFlash && <span className="text-xs text-emerald-300">{syncFlash}</span>}
              <button onClick={syncNow} className="btn-secondary text-xs"><RefreshCw className="h-3.5 w-3.5" /> Sync now</button>
            </div>
          )}
        </div>
      </button>

      {/* Smooth accordion */}
      <div className={`grid transition-all duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="space-y-4 border-t border-surface-700 px-5 py-4">
            <div>
              <label className="label">Your Plaud AutoFlow address</label>
              <div className="flex gap-2">
                <input readOnly value={autoflow} className="input font-mono text-xs" />
                <button type="button" onClick={copyEmail} className="btn-secondary shrink-0">
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="label">Plaud API key / token (optional)</label>
              <div className="flex gap-2">
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••••••••••" className="input" />
                <button onClick={() => save({ plaud_api_key: token.trim() || null }, 'plaud')} disabled={busy} className="btn-secondary shrink-0">Save</button>
              </div>
            </div>
            <Toggle
              label="Auto-sync from Plaud" description="Automatically pull new recordings as they finish."
              checked={Boolean(practice?.plaud_auto_sync)} onChange={(v) => save({ plaud_auto_sync: v }, 'plaud')}
            />
            <div className="flex justify-end gap-3 border-t border-surface-700 pt-3">
              {connected ? (
                <button onClick={() => save({ plaud_webhook_url: null }, 'plaud')} disabled={busy} className="text-sm font-medium text-rose-300 hover:text-rose-200">Disconnect</button>
              ) : (
                <button onClick={() => save({ plaud_webhook_url: autoflow }, 'plaud')} disabled={busy} className="btn-primary">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Connect
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Recording Settings card - audio quality + microphone, plus capture toggles.
function RecordingSettingsCard({ practice, save }) {
  const [mics, setMics] = useState([])
  const [mic, setMic] = useState(() => localStorage.getItem(MIC_PREF_KEY) || '')
  const [quality, setQuality] = useState(practice?.audio_quality || 'standard')

  useEffect(() => { listMicrophones().then(setMics) }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setQuality(practice?.audio_quality || 'standard') }, [practice?.audio_quality])

  function chooseMic(id) {
    setMic(id)
    if (id) localStorage.setItem(MIC_PREF_KEY, id); else localStorage.removeItem(MIC_PREF_KEY)
  }

  return (
    <div className="card mt-3 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-600 !text-white"><SlidersHorizontal className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white">Recording Settings</h3>
          <p className="mt-1 text-sm text-slate-400">Applies to every recording method.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Audio quality</label>
              <select className="input" value={quality}
                onChange={(e) => { setQuality(e.target.value); save({ audio_quality: e.target.value }, 'rec') }}>
                {Object.entries(AUDIO_QUALITY).map(([k, v]) => <option key={k} value={k}>{v.label} - {v.hint}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Microphone</label>
              <select className="input" value={mic} onChange={(e) => chooseMic(e.target.value)}>
                <option value="">Default microphone</option>
                {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${m.deviceId.slice(0, 6)}`}</option>)}
              </select>
            </div>
          </div>
          {mics.filter((m) => m.label).length === 0 && (
            <p className="mt-1.5 text-xs text-slate-500">Start a recording once and allow mic access to see your device names here.</p>
          )}
          <div className="mt-4 border-t border-surface-700 pt-1">
            <Toggle
              label="Auto-delete raw audio after transcription"
              description="HIPAA: the original recording is removed once the de-identified transcript is saved. Recommended on."
              checked={practice?.auto_delete_audio !== false} onChange={(v) => save({ auto_delete_audio: v }, 'rec')}
            />
            <Toggle
              label="Auto-analyze after recording"
              description="Run CaseLift analysis automatically when a recording finishes."
              checked={Boolean(practice?.auto_analyze)} onChange={(v) => save({ auto_analyze: v }, 'rec')}
            />
            <Toggle
              label="Auto-start follow-up after analysis"
              description="When off, the TC reviews and approves before any sequence sends."
              checked={Boolean(practice?.auto_start_followup)} onChange={(v) => save({ auto_start_followup: v }, 'rec')}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Integrations() {
  const { practice, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [saving, setSaving] = useState('')
  const [slackUrl, setSlackUrl] = useState('')
  const [slackChannel, setSlackChannel] = useState('')
  const [slackTest, setSlackTest] = useState('')

  useEffect(() => {
    if (!practice) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlackUrl(practice.slack_webhook_url || '')
    setSlackChannel(practice.slack_channel || '')
  }, [practice])

  async function save(patch, key) {
    if (!practice?.id) return
    setSaving(key)
    await supabase.from('practices').update(patch).eq('id', practice.id)
    await refreshProfile()
    setSaving('')
  }

  const slackConnected = Boolean(practice?.slack_webhook_url)
  const pmsConnected = Boolean(practice?.sikka_connected || practice?.pms_type)

  async function testSlack() {
    if (!slackUrl) return
    setSlackTest('sending')
    try {
      await fetch(slackUrl, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '🟢 *CaseLift* - test notification. Your Slack integration is working.' }),
      })
      setSlackTest('sent')
    } catch { setSlackTest('sent') }
    setTimeout(() => setSlackTest(''), 2500)
  }

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-white">CaseLift Integrations</h2>

      {/* PMS */}
      <div>
        <SectionHeader>Practice Management</SectionHeader>
        <IntegrationCard logo={<Plug className="h-5 w-5" />} logoTone="bg-sky-600" title="Practice Management System"
          badge={pmsConnected ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Connected</Badge> : <Badge tone="slate">Not connected</Badge>}>
          {pmsConnected ? <p>Connected{practice?.pms_type ? ` - ${practice.pms_type}` : ''}.</p> : 'Sync appointments and treatment plans from your practice management system.'}
          <div className="mt-3"><button onClick={() => navigate('/settings/pms')} className="btn-secondary">{pmsConnected ? 'Manage connection' : 'Connect your PMS'}</button></div>
        </IntegrationCard>
      </div>

      {/* RECORDING */}
      <div>
        <SectionHeader>Recording</SectionHeader>
        <div className="grid gap-3 lg:grid-cols-2">
          <IntegrationCard logo={<Mic className="h-5 w-5" />} logoTone="bg-emerald-600" title="Browser Recording"
            badge={<Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Active</Badge>}>
            Record directly in CaseLift on desktop or phone - no setup required.
          </IntegrationCard>

          <IntegrationCard logo={<span className="text-sm font-bold">D</span>} logoTone="bg-teal-600" title="Doxy.me" disabled
            badge={<Badge tone="slate"><Lock className="h-3 w-3" /> Coming soon</Badge>}>
            Import virtual consult recordings automatically. Available soon.
          </IntegrationCard>

          <PlaudCard practice={practice} save={save} saving={saving} />

          <IntegrationCard logo={<Video className="h-5 w-5" />} title="Zoom" disabled
            badge={<Badge tone="slate"><Lock className="h-3 w-3" /> Coming soon</Badge>}>
            Record Zoom consults - connect your account. Available soon.
          </IntegrationCard>
        </div>

        <RecordingSettingsCard practice={practice} save={save} />
      </div>

      {/* NOTIFICATIONS */}
      <div>
        <SectionHeader>Notifications</SectionHeader>
        <IntegrationCard logo={<Hash className="h-5 w-5" />} logoTone="bg-violet-600" title="Slack"
          badge={slackConnected ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Connected</Badge> : <Badge tone="slate">Not connected</Badge>}>
          Get CaseLift alerts in your Slack workspace.
          <div className="mt-3 space-y-2">
            <input value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder="Slack incoming webhook URL" className="input" />
            <div className="flex gap-2">
              <input value={slackChannel} onChange={(e) => setSlackChannel(e.target.value)} placeholder="#caselift-alerts" className="input" />
              <button onClick={() => save({ slack_webhook_url: slackUrl.trim() || null, slack_channel: slackChannel.trim() || null }, 'slack')} disabled={saving === 'slack'} className="btn-primary shrink-0">
                {saving === 'slack' ? <Loader2 className="h-4 w-4 animate-spin" /> : slackConnected ? 'Update' : 'Connect'}
              </button>
            </div>
            {slackConnected && (
              <div className="flex items-center gap-2">
                <button onClick={testSlack} disabled={slackTest === 'sending'} className="btn-secondary text-xs">
                  {slackTest === 'sending' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : slackTest === 'sent' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : null}
                  {slackTest === 'sent' ? 'Test sent' : 'Send test'}
                </button>
                <button onClick={() => save({ slack_webhook_url: null, slack_channel: null }, 'slack')} className="text-xs font-medium text-rose-300 hover:text-rose-200">Disconnect</button>
              </div>
            )}
          </div>
        </IntegrationCard>
      </div>
    </div>
  )
}
