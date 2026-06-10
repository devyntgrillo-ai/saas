import { useState } from 'react'
import { Mic, PlayCircle, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useRecorder } from '../context/RecorderContext'

// 60-second "how to record" walkthrough. Swap for your real Loom/YouTube link.
const HELP_VIDEO_URL = 'https://www.youtube.com/results?search_query=caselift+how+to+record+a+consult'

// One-time, role-appropriate welcome for someone invited to RECORD consults
// (a team member / recorder, not necessarily a treatment coordinator). Shown
// once per user via localStorage. Owners/admins/agency/super-admins never see it.
export default function TeamMemberWelcome() {
  const { user, profile, practice, practiceId, isAgencyView, isSuperAdmin } = useAuth()
  const { openRecorder } = useRecorder()

  const role = profile?.role || ''
  const isRecorder = Boolean(role) && !['owner', 'admin'].includes(role)
  const seenKey = user?.id ? `cl_recorder_welcome_seen_${user.id}` : null

  const [show, setShow] = useState(() => {
    if (!seenKey) return false
    try { return localStorage.getItem(seenKey) !== '1' } catch { return false }
  })

  // Only for a practice-scoped recorder on their own account.
  if (!show || !practiceId || isAgencyView || isSuperAdmin || !isRecorder) return null

  const firstName = (profile?.display_name || user?.email || 'there').trim().split(/\s+/)[0]
  const practiceName = practice?.name || 'Your practice'

  function dismiss() {
    try { if (seenKey) localStorage.setItem(seenKey, '1') } catch { /* noop */ }
    setShow(false)
  }
  function startRecording() { dismiss(); openRecorder() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-2xl border border-surface-700 bg-surface-900 p-7 shadow-2xl">
        <button onClick={dismiss} className="absolute right-4 top-4 rounded-md p-1.5 text-slate-500 hover:bg-surface-800 hover:text-slate-200" aria-label="Close">
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary-300">
          <Mic className="h-6 w-6" />
        </div>

        <h1 className="text-xl font-bold text-white">Welcome to CaseLift, {firstName}!</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          {practiceName} is using CaseLift to automatically follow up with patients after consultations.
        </p>

        <div className="mt-4 rounded-xl border border-surface-700 bg-surface-800/50 p-4">
          <p className="text-sm font-semibold text-white">Your role</p>
          <p className="mt-1 text-sm text-slate-300">Record consultations so CaseLift can analyze them and handle the follow-up.</p>
        </div>

        <div className="mt-4">
          <p className="text-sm font-semibold text-white">Here’s all you need to do:</p>
          <ol className="mt-2 space-y-1.5 text-sm text-slate-300">
            <li className="flex gap-2"><span className="font-semibold text-primary-300">1.</span> Record the consultation (we’ll show you how).</li>
            <li className="flex gap-2"><span className="font-semibold text-primary-300">2.</span> CaseLift handles everything after.</li>
          </ol>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <a href={HELP_VIDEO_URL} target="_blank" rel="noreferrer" onClick={dismiss} className="btn-ghost justify-center sm:flex-1">
            <PlayCircle className="h-4 w-4" /> Watch how to record, 60 seconds
          </a>
          <button onClick={startRecording} className="btn-primary justify-center sm:flex-1">
            <Mic className="h-4 w-4" /> Start recording now
          </button>
        </div>
      </div>
    </div>
  )
}
