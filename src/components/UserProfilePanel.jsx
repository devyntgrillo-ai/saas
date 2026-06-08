import { useRef, useState } from 'react'
import { Loader2, Check, Camera } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { uploadAvatar, updateMyProfile } from '../lib/profile'
import { Avatar } from './chat/ChatMessage'

// Settings → Your Profile: set the display name + avatar shown across the app.
export default function UserProfilePanel() {
  const { user, profile, refreshProfile } = useAuth()
  const [name, setName] = useState(profile?.display_name || user?.user_metadata?.full_name || '')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
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

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      let avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || null
      if (file) avatarUrl = await uploadAvatar(user.id, file)
      await updateMyProfile({ displayName: name.trim(), avatarUrl })
      await refreshProfile()
      setFile(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e?.message || 'Could not save your profile. Please try again.')
    }
    setSaving(false)
  }

  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-white">Your Profile</h2>
      <p className="mt-1 text-sm text-slate-400">
        Your name and photo appear across CaseLift — in the coaching channel, your team list, and the sidebar.
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

      <div className="mt-5">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? 'Saved' : 'Save profile'}
        </button>
      </div>
    </div>
  )
}
