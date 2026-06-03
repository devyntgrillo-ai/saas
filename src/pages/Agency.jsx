import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom'
import {
  Building2,
  Plus,
  PhoneCall,
  Send,
  Trophy,
  ChevronRight,
  LayoutGrid,
  X,
  Loader2,
  Copy,
  Check,
  Palette,
  Upload,
  Image as ImageIcon,
  RotateCcw,
  Eye,
  Mic,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useBranding } from '../context/BrandingContext'
import { applyPrimaryColor, resetPrimaryColor } from '../lib/whitelabel'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/consults'
import { fetchRecordingRate, rateColor } from '../lib/pms'
import AgencyTabs from '../components/AgencyTabs'

function startOfMonthISODate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

async function loadMetrics(practiceId) {
  const monthStart = startOfMonthISODate()
  const [consults, followUps, active, lastConsult, lastMessage] = await Promise.all([
    supabase.from('consults').select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId).gte('recording_date', monthStart),
    supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId).in('status', ['sent', 'opened', 'replied']),
    supabase.from('consults').select('id', { count: 'exact', head: true })
      .eq('practice_id', practiceId).eq('status', 'active'),
    supabase.from('consults').select('created_at').eq('practice_id', practiceId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('messages').select('created_at').eq('practice_id', practiceId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const times = [lastConsult.data?.created_at, lastMessage.data?.created_at].filter(Boolean)
  const lastActivity = times.length ? times.sort().at(-1) : null
  let recordingRate = null
  try {
    recordingRate = (await fetchRecordingRate(practiceId, 4)).current
  } catch {
    /* non-critical */
  }
  return {
    consults: consults.count || 0,
    followUps: followUps.count || 0,
    active: active.count || 0,
    lastActivity,
    recordingRate,
  }
}

function AddPracticeModal({ agencyId, onClose, onAdded }) {
  const [form, setForm] = useState({ practice_name: '', doctor_first: '', doctor_last: '', email: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    const { data, error: fnError } = await supabase.functions.invoke('invite-practice-user', {
      body: {
        agency_id: agencyId,
        practice_name: form.practice_name,
        doctor_first: form.doctor_first,
        doctor_last: form.doctor_last,
        email: form.email,
        redirect_to: `${window.location.origin}/accept-invite`,
      },
    })
    setSubmitting(false)
    if (fnError) {
      setError(fnError.message || 'Failed to add practice')
      return
    }
    setResult(data)
    onAdded?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-surface-700 bg-surface-900">
        <div className="flex items-center justify-between border-b border-surface-700 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">Add a client practice</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-surface-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {result ? (
          <div className="space-y-4 p-5">
            {result.warning ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                {result.warning}
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                Practice created.{' '}
                {result.email_sent
                  ? 'An invite email was sent to the treatment coordinator.'
                  : result.invite_link
                    ? 'Share the invite link below with the treatment coordinator.'
                    : 'No invite link was generated - reopen the practice to resend the invite.'}
              </div>
            )}
            {result.invite_link && (
              <div>
                <label className="label">Invite link</label>
                <div className="flex gap-2">
                  <input className="input font-mono text-xs" readOnly value={result.invite_link} />
                  <button
                    type="button"
                    className="btn-ghost shrink-0"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(result.invite_link)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      } catch { /* noop */ }
                    }}
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  The TC clicks this to set a password, accept the BAA, and reach their dashboard.
                </p>
              </div>
            )}
            <button onClick={onClose} className="btn-primary w-full">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-5">
            <div>
              <label className="label">Practice name</label>
              <input className="input" required value={form.practice_name}
                onChange={(e) => set('practice_name', e.target.value)} placeholder="Riverside Implant Center" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Doctor first name</label>
                <input className="input" value={form.doctor_first}
                  onChange={(e) => set('doctor_first', e.target.value)} placeholder="Jordan" />
              </div>
              <div>
                <label className="label">Doctor last name</label>
                <input className="input" value={form.doctor_last}
                  onChange={(e) => set('doctor_last', e.target.value)} placeholder="Rivera" />
              </div>
            </div>
            <div>
              <label className="label">TC email (invite recipient)</label>
              <input className="input" type="email" required value={form.email}
                onChange={(e) => set('email', e.target.value)} placeholder="tc@riverside.com" />
            </div>
            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
            )}
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? 'Creating & inviting…' : 'Create practice & send invite'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function MetricChip({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-slate-500" />
      <span className="font-semibold text-slate-200">{value}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  )
}

// Compact on/off toggle for the white-label master switch.
function BrandSwitch({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? 'bg-primary' : 'bg-surface-700'}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

// Drag-and-drop / click-to-upload tile for a logo or favicon.
function UploadZone({ kind, url, uploading, inputRef, onFile, onClear, hint, compact }) {
  const [dragOver, setDragOver] = useState(false)
  const accept = kind === 'favicon' ? 'image/png,image/x-icon,image/svg+xml' : 'image/png,image/svg+xml,image/jpeg'
  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]) }}
        className={[
          'flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 transition',
          compact ? 'py-2' : 'py-3',
          dragOver ? 'border-primary bg-primary/10' : 'border-surface-600 hover:border-surface-500 hover:bg-surface-800/50',
        ].join(' ')}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-800">
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : url ? (
            <img src={url} alt="" className="h-full w-full object-contain" />
          ) : (
            <ImageIcon className="h-4 w-4 text-slate-500" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
            <Upload className="h-3.5 w-3.5" /> {url ? 'Replace' : 'Upload'} - drag &amp; drop or click
          </p>
          {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
        </div>
        {url && !uploading && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onClear() }}
            className="shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-surface-700 hover:text-slate-300">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

// Miniature sidebar that mirrors the real one, recolored with the chosen brand
// (inline styles so unsaved values preview without touching the global theme).
function SidebarPreview({ color, logoUrl, companyName }) {
  const tint = `${color}22` // ~13% opacity active-nav tint
  return (
    <div className="overflow-hidden rounded-xl border border-surface-700 bg-surface-900">
      <div className="px-3 pb-2 pt-3">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-7 max-w-[140px] object-contain" />
        ) : (
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: color }}>
              <span className="text-xs font-bold text-white">{(companyName[0] || 'B').toUpperCase()}</span>
            </span>
            <span className="truncate text-sm font-bold tracking-tight text-white">{companyName}</span>
          </div>
        )}
      </div>
      <div className="space-y-1 px-2 py-2">
        <div className="flex h-8 items-center gap-2 rounded-md border-l-2 px-2 text-xs font-medium"
          style={{ borderColor: color, backgroundColor: tint, color }}>
          <LayoutGrid className="h-3.5 w-3.5" /> Dashboard
        </div>
        {['Consults', 'Conversations'].map((l) => (
          <div key={l} className="flex h-8 items-center gap-2 rounded-md border-l-2 border-transparent px-2 text-xs text-slate-400">
            <ChevronRight className="h-3.5 w-3.5" /> {l}
          </div>
        ))}
      </div>
      <div className="px-2 pb-3 pt-1">
        <div className="flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-white"
          style={{ backgroundColor: color }}>
          <Mic className="h-3.5 w-3.5" /> Record Consult
        </div>
      </div>
    </div>
  )
}

export default function Agency() {
  const { agency, agencyRole, agencyLoading, isAgencyUser, viewPractice, refreshAgency } = useAuth()
  const { invalidateBrand } = useBranding()
  const navigate = useNavigate()
  // Sub-view is URL-driven (?tab=) so the shared AgencyTabs bar can link to it
  // from any agency route and deep-links work.
  const [searchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'overview'
  const [practices, setPractices] = useState([])
  const [metrics, setMetrics] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  // Agency settings form
  const [settings, setSettings] = useState({})
  const [savingSettings, setSavingSettings] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [uploading, setUploading] = useState(null) // 'logo' | 'favicon' | null
  const [uploadError, setUploadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const logoInputRef = useRef(null)
  const faviconInputRef = useRef(null)

  // Seed the form once per agency (keyed on id, NOT the object) so that the
  // refreshAgency() after each auto-save doesn't re-seed and clobber a field the
  // user is still editing.
  useEffect(() => {
    if (agency) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings({
        name: agency.name || '',
        company_name: agency.company_name || agency.brand_name || '',
        logo_url: agency.logo_url || '',
        favicon_url: agency.favicon_url || '',
        primary_color: agency.primary_color || '#0EA5E9',
        support_email: agency.support_email || '',
        domain: agency.domain || '',
        white_label_enabled: agency.white_label_enabled ?? Boolean(agency.company_name || agency.logo_url),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id])

  const loadPractices = useCallback(async () => {
    if (!agency?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('practices')
      .select('id, name, doctor_first, doctor_last, baa_accepted_at')
      .eq('agency_id', agency.id)
      .order('created_at', { ascending: true })
    const rows = data || []
    setPractices(rows)
    const entries = await Promise.all(rows.map(async (p) => [p.id, await loadMetrics(p.id)]))
    setMetrics(Object.fromEntries(entries))
    setLoading(false)
  }, [agency?.id])

  // Load the practice list and per-practice metrics on mount / agency change.
  useEffect(() => {
    loadPractices() // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadPractices])

  function impersonate(p) {
    viewPractice(p.id)
    navigate('/')
  }

  // Auto-save: persist a brand patch immediately (optimistic + resilient), so no
  // edit is ever lost to navigating away or forgetting a Save button. Each field
  // calls this on change/blur.
  async function saveBrand(patch) {
    if (!agency?.id) return false
    setSettings((s) => ({ ...s, ...patch })) // optimistic
    setSavingSettings(true)
    setSaveError('')
    const { error } = await supabase.from('agency_accounts').update(patch).eq('id', agency.id).select().maybeSingle()
    if (error) {
      // A "column ... does not exist" / schema-cache error means the brand
      // migration hasn't been applied yet - surface it instead of failing silently.
      const schemaIssue = /column|schema cache|PGRST/i.test(`${error.message} ${error.code || ''}`)
      setSaveError(
        schemaIssue
          ? 'Save failed: the brand columns are missing. Apply migration 20260530040000_reseller_white_label_branding.sql to your Supabase project.'
          : `Save failed: ${error.message}`,
      )
      setSavingSettings(false)
      return false
    }
    if ('primary_color' in patch) {
      patch.primary_color ? applyPrimaryColor(patch.primary_color) : resetPrimaryColor()
    }
    invalidateBrand() // drop the cached theme so it re-resolves from fresh data
    refreshAgency() // updates `agency` so the brand re-applies app-wide (seed effect keys on id, so this won't clobber edits)
    setSavingSettings(false)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
    return true
  }

  // Company name turns white-label on once set and keeps the legacy alias synced.
  function saveCompanyName(v) {
    const name = (v || '').trim()
    saveBrand({ company_name: name || null, brand_name: name || null, ...(name ? { white_label_enabled: true } : {}) })
  }

  // Wipe the brand back to CaseLift defaults and persist.
  async function resetToCaseLift() {
    setPreviewing(false)
    resetPrimaryColor()
    await saveBrand({
      company_name: null,
      brand_name: null,
      logo_url: null,
      favicon_url: null,
      primary_color: null,
      white_label_enabled: false,
    })
    setSettings((s) => ({ ...s, primary_color: '#0EA5E9' }))
  }

  // Apply the (possibly unsaved) form color live so the reseller can see what
  // their clients will see before saving. Toggles back to the saved brand.
  function togglePreview() {
    if (previewing) {
      if (agency?.primary_color) applyPrimaryColor(agency.primary_color)
      else resetPrimaryColor()
      setPreviewing(false)
    } else {
      if (settings.primary_color) applyPrimaryColor(settings.primary_color)
      setPreviewing(true)
    }
  }

  // Upload a logo/favicon to the public reseller-assets bucket and store its URL.
  async function uploadAsset(kind, file) {
    setUploadError('')
    if (!file || !agency?.id) return
    const okTypes = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/x-icon', 'image/vnd.microsoft.icon']
    if (!okTypes.includes(file.type)) {
      setUploadError('Use a PNG, SVG, or ICO file.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('File must be under 2MB.')
      return
    }
    setUploading(kind)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      // A stable per-kind path keeps one asset per reseller (upsert overwrites).
      const path = `${agency.id}/${kind}.${ext}`
      const { error } = await supabase.storage
        .from('reseller-assets')
        .upload(path, file, { contentType: file.type, upsert: true })
      if (error) throw error
      const { data } = supabase.storage.from('reseller-assets').getPublicUrl(path)
      // Cache-bust so a re-upload to the same path shows immediately.
      const url = `${data.publicUrl}?v=${file.size}`
      // Persist immediately (auto-save) - no separate Save click needed.
      await saveBrand({ [kind === 'logo' ? 'logo_url' : 'favicon_url']: url, white_label_enabled: true })
    } catch (err) {
      setUploadError(err.message || 'Upload failed.')
    } finally {
      setUploading(null)
    }
  }

  // Only agency users belong here.
  if (!agencyLoading && !isAgencyUser) return <Navigate to="/" replace />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {agency?.logo_url ? (
            <img src={agency.logo_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
              <Building2 className="h-5 w-5" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-white">{agency?.name || 'Reseller'}</h1>
              <span className="rounded-full bg-[var(--accent-subtle)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent)]">RESELLER</span>
            </div>
            <p className="text-sm text-slate-400 capitalize">{agencyRole} · {practices.length} client practices</p>
          </div>
        </div>
        {tab === 'overview' && (
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Add Practice
          </button>
        )}
      </div>

      {/* Shared tab bar (persists across all agency pages). */}
      <AgencyTabs />

      {tab === 'phone' ? (
        <Navigate to="/agency" replace />
      ) : tab === 'overview' ? (
        loading ? (
          <div className="py-16 text-center text-sm text-slate-500">Loading client practices…</div>
        ) : practices.length === 0 ? (
          <div className="card px-6 py-16 text-center">
            <Building2 className="mx-auto h-9 w-9 text-slate-600" />
            <p className="mt-3 text-sm text-slate-400">No client practices yet.</p>
            <button onClick={() => setShowAdd(true)} className="btn-primary mt-4">
              <Plus className="h-4 w-4" /> Add your first practice
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {practices.map((p) => {
              const m = metrics[p.id] || {}
              const doctor = [p.doctor_first, p.doctor_last].filter(Boolean).join(' ')
              return (
                <button
                  key={p.id}
                  onClick={() => impersonate(p)}
                  className="card group p-5 text-left transition hover:border-surface-600 hover:bg-surface-800/40"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-100">{p.name}</p>
                      <p className="truncate text-sm text-slate-500">
                        {doctor ? `Dr. ${doctor}` : 'Doctor not set'}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-600 transition group-hover:text-primary-400" />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                    <MetricChip icon={PhoneCall} label="consults" value={m.consults ?? '-'} />
                    <MetricChip icon={Send} label="follow-ups" value={m.followUps ?? '-'} />
                    <MetricChip icon={Trophy} label="active" value={m.active ?? '-'} />
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-surface-700 pt-3 text-xs text-slate-500">
                    <span className="truncate">
                      {m.lastActivity ? `Last activity ${timeAgo(m.lastActivity)} ago` : 'No activity yet'}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {m.recordingRate && m.recordingRate.total > 0 && (
                        <span
                          className={`rounded-full bg-surface-800 px-2 py-0.5 font-semibold ${rateColor(m.recordingRate.rate).text}`}
                          title={`Recorded ${m.recordingRate.recorded} of ${m.recordingRate.total} implant consults this week`}
                        >
                          {m.recordingRate.rate}% recorded
                        </span>
                      )}
                      {!p.baa_accepted_at && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-300">
                          BAA pending
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )
      ) : (
        <div className="card max-w-3xl p-6">
          {/* Header + auto-save status */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                <Palette className="h-4 w-4 text-primary-400" /> Brand &amp; White-label
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                What your clients see instead of CaseLift. Changes save automatically.
              </p>
            </div>
            <span className="flex h-5 shrink-0 items-center text-xs">
              {savingSettings ? (
                <span className="inline-flex items-center gap-1.5 text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>
              ) : savedFlash ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-300"><Check className="h-3.5 w-3.5" /> Saved</span>
              ) : null}
            </span>
          </div>

          {/* Master on/off */}
          <label className="mt-5 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-surface-700 bg-surface-800/40 px-4 py-3">
            <span>
              <span className="block text-sm font-medium text-slate-200">White-label enabled</span>
              <span className="mt-0.5 block text-xs text-slate-500">When off, your client practices see CaseLift branding.</span>
            </span>
            <BrandSwitch checked={Boolean(settings.white_label_enabled)} onChange={(v) => saveBrand({ white_label_enabled: v })} />
          </label>

          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_240px]">
            {/* ---- Fields (each auto-saves) ---- */}
            <div className="space-y-5">
              <div>
                <label className="label">Company name</label>
                <input className="input" value={settings.company_name || ''}
                  onChange={(e) => setSettings((s) => ({ ...s, company_name: e.target.value }))}
                  onBlur={(e) => saveCompanyName(e.target.value)}
                  placeholder="e.g. NW Recovery Suite" />
                <p className="mt-1.5 text-xs text-slate-500">Shown to clients in place of “CaseLift”.</p>
              </div>

              <div>
                <label className="label">Primary color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={settings.primary_color || '#0EA5E9'}
                    onChange={(e) => saveBrand({ primary_color: e.target.value })}
                    className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-surface-700 bg-surface-800" />
                  <input className="input font-mono" value={settings.primary_color || ''}
                    onChange={(e) => setSettings((s) => ({ ...s, primary_color: e.target.value }))}
                    onBlur={(e) => saveBrand({ primary_color: e.target.value || null })}
                    placeholder="#0EA5E9" />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">Buttons, active nav, badges, the Record button.</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">Logo</label>
                  <UploadZone kind="logo" url={settings.logo_url} uploading={uploading === 'logo'} inputRef={logoInputRef}
                    onFile={(f) => uploadAsset('logo', f)} onClear={() => saveBrand({ logo_url: null })} hint="PNG/SVG · 2MB" compact />
                </div>
                <div>
                  <label className="label">Favicon <span className="text-slate-500">(optional)</span></label>
                  <UploadZone kind="favicon" url={settings.favicon_url} uploading={uploading === 'favicon'} inputRef={faviconInputRef}
                    onFile={(f) => uploadAsset('favicon', f)} onClear={() => saveBrand({ favicon_url: null })} hint="PNG/ICO · 2MB" compact />
                </div>
              </div>

              <div>
                <label className="label">Support email</label>
                <input className="input" type="email" value={settings.support_email || ''}
                  onChange={(e) => setSettings((s) => ({ ...s, support_email: e.target.value }))}
                  onBlur={(e) => saveBrand({ support_email: e.target.value || null })}
                  placeholder="support@youragency.com" />
                <p className="mt-1.5 text-xs text-slate-500">Reply-to on client emails; shown in error + billing screens.</p>
              </div>

              {/* Advanced - rarely changed, collapsed to keep the form clean. */}
              <details className="rounded-lg border border-surface-700 bg-surface-800/30">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-slate-300">Advanced</summary>
                <div className="space-y-4 border-t border-surface-700 px-4 py-4">
                  <div>
                    <label className="label">White-label domain <span className="text-slate-500">(future)</span></label>
                    <input className="input" value={settings.domain || ''}
                      onChange={(e) => setSettings((s) => ({ ...s, domain: e.target.value }))}
                      onBlur={(e) => saveBrand({ domain: e.target.value || null })}
                      placeholder="app.youragency.com" />
                  </div>
                  <div>
                    <label className="label">Reseller name <span className="text-slate-500">(internal)</span></label>
                    <input className="input" value={settings.name || ''}
                      onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
                      onBlur={(e) => saveBrand({ name: e.target.value })} />
                  </div>
                </div>
              </details>

              {uploadError && <p className="text-xs text-rose-400">{uploadError}</p>}
              {saveError && (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{saveError}</p>
              )}
            </div>

            {/* ---- Live preview + actions (sticky) ---- */}
            <div className="lg:sticky lg:top-4 lg:self-start">
              <p className="label">Client preview</p>
              <SidebarPreview
                color={settings.primary_color || '#0EA5E9'}
                logoUrl={settings.logo_url}
                companyName={settings.company_name || 'Your Brand'}
              />
              <button type="button" onClick={togglePreview} className="btn-ghost mt-3 w-full justify-center">
                <Eye className="h-4 w-4" /> {previewing ? 'Stop preview' : 'Preview as client'}
              </button>
              <button type="button" onClick={resetToCaseLift}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-300">
                <RotateCcw className="h-3.5 w-3.5" /> Reset to CaseLift defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <AddPracticeModal
          agencyId={agency?.id}
          onClose={() => setShowAdd(false)}
          onAdded={loadPractices}
        />
      )}
    </div>
  )
}
