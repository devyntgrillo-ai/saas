import { useRef, useState } from 'react'
import { Loader2, Check, Camera } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { ROLE_OPTIONS } from '../lib/profile'
import { useUpdateMyProfile } from '../lib/queries'
import { Avatar } from './chat/ChatMessage'
import MfaSetup from './MfaSetup'

// Settings → Your Profile: set the display name + avatar + role shown across the app.
export default function UserProfilePanel() {
  const { user, profile, refreshProfile } = useAuth()
  const [name, setName] = useState(profile?.display_name || user?.user_metadata?.full_name || '')
  const initialRole = profile?.job_title || ''
  const initialIsPreset = ROLE_OPTIONS.includes(initialRole)
  const [roleSel, setRoleSel] = useState(initialIsPreset ? initialRole : initialRole ? '__other' : '')
  const [roleOther, setRoleOther] = useState(initialIsPreset ? '' : initialRole)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const updateProfile = useUpdateMyProfile()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const currentAvatar = preview || profile?.avatar_url || user?.user_metadata?.avatar_url || null
  const previewName = name.trim() || user?.email

  function pickFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { setError('Image must be under 5MB'); return }
    setError('')
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  function save() {
    if (updateProfile.isPending) return
    setError('')
    setSaved(false)
    const jobTitle = roleSel === '__other' ? roleOther.trim() : roleSel
    updateProfile.mutate(
      {
        userId: user.id,
        displayName: name.trim(),
        avatarUrl: profile?.avatar_url || user?.user_metadata?.avatar_url || null,
        jobTitle,
        file,
      },
      {
        onSuccess: async () => {
          await refreshProfile()
          setFile(null)
          setSaved(true)
          setTimeout(() => setSaved(false), 2500)
        },
        onError: (e) => setError(e?.message || 'Could not save your profile. Please try again.'),
      },
    )
  }

  const saving = updateProfile.isPending

  return (
    <div className="space-y-6">
    <div className="card p-6">
      <h2 className="text-base font-semibold text-white">Your Profile</h2>
      <p className="mt-1 text-sm text-slate-400">
        Your name and photo appear across CaseLift, in the coaching channel, your team list, and the sidebar.
      </p>
      {error && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      <div className="mt-5 flex items-center gap-4">
        <div className="relative shrink-0">
          <Avatar name={previewName} url={currentAvatar} size="h-16 w-16" />
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary !text-white ring-2 ring-surface-900 transition hover:bg-primary-700"
            title="Upload photo"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickFile} />
        </div>
        <div className="min-w-0 flex-1">
          <label className="label">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Devyn Grillo"
            className="input"
            maxLength={60}
          />
          <p className="mt-1 truncate text-xs text-slate-500">{user?.email}</p>
        </div>
      </div>

      <div className="mt-5 max-w-sm">
        <label className="label">Your role</label>
        <select value={roleSel} onChange={(e) => setRoleSel(e.target.value)} className="input">
          <option value="">Select your role…</option>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          <option value="__other">Other…</option>
        </select>
        {roleSel === '__other' && (
          <input
            value={roleOther}
            onChange={(e) => setRoleOther(e.target.value)}
            placeholder="e.g. Dental Hygienist"
            className="input mt-2"
            maxLength={60}
          />
        )}
        <p className="mt-1 text-xs text-slate-500">Helps your team see who's who in CaseLift.</p>
      </div>

      <div className="mt-5">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? 'Saved' : 'Save profile'}
        </button>
      </div>
    </div>

    <MfaSetup />
    </div>
  )
}
