import { useEffect, useRef, useState } from 'react'
import { Gift, Star, Video, UserPlus, Check, Loader2, ExternalLink, Square, Pause, Play, RefreshCcw, PartyPopper } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  useUpdateFreeMonth,
  useUploadTestimonial,
  useReferFriend,
  isMutating,
} from '../lib/queries'

// Where the "leave a review" button sends people. Swap for your real review link
// (Google Business, Capterra, Trustpilot, etc.).
const REVIEW_URL = 'https://www.trustpilot.com/evaluate/caselift.io'

const MAX_SECONDS = 120 // 2:00 recording ceiling - auto-stops here
const WARN_AT = 100 // final 20s: show an "ending soon" countdown
function fmt(s) {
  const m = Math.floor(s / 60)
  const x = s % 60
  return `${m}:${String(x).padStart(2, '0')}`
}

function StepCard({ n, icon: Icon, title, done, children }) {
  return (
    <div className={`rounded-2xl border p-5 transition ${done ? 'border-emerald-500/40 bg-emerald-500/[0.05]' : 'border-surface-700 bg-surface-900'}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-500 !text-white' : 'bg-primary/10 text-primary-300'}`}>
          {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Step {n}</span>
            {done && <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">Done</span>}
          </div>
          <h3 className="mt-0.5 text-base font-semibold text-white">{title}</h3>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  )
}

export default function GetFreeMonth({ practice }) {
  const { practiceId, refreshProfile } = useAuth()
  const fm = practice?.free_month || {}
  const reviewDone = Boolean(fm.review_at)
  const videoDone = Boolean(fm.video_at)
  const referralDone = Boolean(fm.referral_at)
  const allDone = reviewDone && videoDone && referralDone
  const granted = Boolean(fm.granted_at)

  const updateFreeMonth = useUpdateFreeMonth()
  const uploadTestimonial = useUploadTestimonial()
  const referFriend = useReferFriend()
  const [error, setError] = useState('')

  // Video recorder state
  const liveRef = useRef(null)
  const recRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const maxTimerRef = useRef(null)
  const [phase, setPhase] = useState('idle') // idle | countdown | recording
  const [countdown, setCountdown] = useState(3)
  const [countdownPaused, setCountdownPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [blob, setBlob] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)

  // Friend form + an editable, prepopulated email the sender can tweak before sending.
  const practiceName = practice?.name || 'our practice'
  const [friend, setFriend] = useState({ name: '', email: '' })
  const draftSeeded = useRef(false)
  const [draft, setDraft] = useState({ subject: '', message: '' })
  useEffect(() => {
    if (draftSeeded.current || !practice) return
    draftSeeded.current = true
    setDraft({
      subject: `${practiceName} recommends CaseLift`,
      // No greeting here, the edge function prepends a personalized "Hi {friend},"
      // at send time, since the friend's name isn't known when this draft is seeded.
      message:
        `I wanted to share a tool we have been using at ${practiceName}, called CaseLift. It records our treatment consults and automatically follows up with patients by text and email, and it has helped us recover cases that used to slip through the cracks.\n\n` +
        `I think it could do the same for your practice. Worth a quick look.`,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practice])

  async function saveFm(patch) {
    try {
      await updateFreeMonth.mutateAsync({ practiceId, patch, current: practice?.free_month })
      await refreshProfile()
      return true
    } catch (e) {
      setError(e?.message || 'Could not save.')
      return false
    }
  }

  // Auto-grant the free month once all three are checked off.
  useEffect(() => {
    if (!allDone || granted || !practiceId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void saveFm({ granted_at: new Date().toISOString() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, granted, practiceId])

  // ── Step 1: review ────────────────────────────────────────────────────────
  async function markReview() {
    setError('')
    await saveFm({ review_at: new Date().toISOString() })
  }

  // ── Step 2: video testimonial ───────────────────────────────────────────────
  // Open the camera and run a pausable 3-2-1 countdown; recording auto-starts at 0.
  async function beginCountdown() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 720 }, height: { ideal: 1280 }, aspectRatio: { ideal: 9 / 16 } },
        audio: true,
      })
      streamRef.current = stream
      // The preview frame is hidden until now, so it isn't mounted yet - the
      // attach effect below wires the stream once the frame renders.
      setCountdown(3)
      setCountdownPaused(false)
      setPhase('countdown')
    } catch {
      setError('Could not access your camera and microphone. Check browser permissions and try again.')
    }
  }
  function beginRecording() {
    const stream = streamRef.current
    if (!stream) return
    chunksRef.current = []
    const mr = new MediaRecorder(stream)
    mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
    mr.onstop = () => {
      const b = new Blob(chunksRef.current, { type: mr.mimeType || 'video/webm' })
      setBlob(b)
      setBlobUrl(URL.createObjectURL(b))
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    mr.start()
    recRef.current = mr
    setElapsed(0)
    setPhase('recording')
    // Hard 2:00 ceiling - auto-stop without driving it from a render effect.
    maxTimerRef.current = setTimeout(() => stopRecording(), MAX_SECONDS * 1000)
  }
  function stopRecording() {
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null }
    try { recRef.current?.stop() } catch { /* noop */ }
    setPhase('idle')
  }
  function cancelCountdown() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setPhase('idle')
  }
  function resetVideo() {
    setBlob(null)
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    setBlobUrl(null)
    setElapsed(0)
    setPhase('idle')
  }

  // Attach the live camera stream to the preview once the frame is on screen
  // (it stays hidden until the user clicks Record, so we can't attach earlier).
  useEffect(() => {
    if ((phase === 'countdown' || phase === 'recording') && !blobUrl && liveRef.current && streamRef.current) {
      liveRef.current.srcObject = streamRef.current
      liveRef.current.muted = true
      liveRef.current.play().catch(() => {})
    }
  }, [phase, blobUrl])

  // Pausable 3-2-1 countdown - ticks while in the countdown phase and not paused.
  useEffect(() => {
    if (phase !== 'countdown' || countdownPaused) return undefined
    if (countdown <= 0) { beginRecording(); return undefined }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown, countdownPaused])

  // Recording timer - drives the on-screen elapsed clock (display only; the hard
  // stop is the setTimeout scheduled in beginRecording).
  useEffect(() => {
    if (phase !== 'recording') return undefined
    const t = setInterval(() => setElapsed((s) => Math.min(s + 1, MAX_SECONDS)), 1000)
    return () => clearInterval(t)
  }, [phase])

  useEffect(() => () => { if (maxTimerRef.current) clearTimeout(maxTimerRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  async function submitVideo() {
    if (!blob) return
    setError('')
    try {
      const { path } = await uploadTestimonial.mutateAsync({ practiceId, blob })
      await saveFm({ video_at: new Date().toISOString(), video_path: path })
    } catch (e) {
      setError(e?.message || 'Could not upload your video. Please try again.')
    }
  }

  // ── Step 3: refer a friend ──────────────────────────────────────────────────
  async function sendReferral() {
    if (!friend.email.trim()) return
    setError('')
    try {
      await referFriend.mutateAsync({
        practiceId,
        friendName: friend.name.trim(),
        friendEmail: friend.email.trim(),
        subject: draft.subject.trim(),
        message: draft.message.trim(),
      })
      await saveFm({ referral_at: new Date().toISOString(), referral_email: friend.email.trim() })
    } catch (err) {
      setError(err?.message || 'Could not send the email. Please try again.')
    }
  }

  const reviewBusy = isMutating(updateFreeMonth, (v) => v.patch?.review_at)
  const videoBusy = uploadTestimonial.isPending || isMutating(updateFreeMonth, (v) => v.patch?.video_at)
  const referralBusy = referFriend.isPending || isMutating(updateFreeMonth, (v) => v.patch?.referral_at)

  const completedCount = [reviewDone, videoDone, referralDone].filter(Boolean).length

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-primary/10 p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300"><Gift className="h-6 w-6" /></span>
          <div>
            <h2 className="text-xl font-bold text-white">Get a free month</h2>
            <p className="mt-1 text-sm text-slate-300">Knock out three quick things and your next month is on us. Takes about 3 minutes.</p>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-800">
                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(completedCount / 3) * 100}%` }} />
              </div>
              <span className="text-xs font-medium text-slate-400">{completedCount} of 3</span>
            </div>
          </div>
        </div>
      </div>

      {granted && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-4">
          <PartyPopper className="h-6 w-6 shrink-0 text-emerald-300" />
          <div>
            <p className="text-sm font-semibold text-emerald-200">Your next month is free! 🎉</p>
            <p className="mt-0.5 text-sm text-emerald-200/80">Thanks for the love. The credit is applied to your account.</p>
          </div>
        </div>
      )}

      {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      <StepCard n={1} icon={Star} title="Leave a quick review" done={reviewDone}>
        {reviewDone ? (
          <p className="text-sm text-slate-400">Thanks for the review!</p>
        ) : (
          <>
            <p className="text-sm text-slate-400">An honest review takes about a minute and helps other practices find CaseLift.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={REVIEW_URL} target="_blank" rel="noreferrer" className="btn-ghost"><ExternalLink className="h-4 w-4" /> Open review page</a>
              <button onClick={markReview} disabled={reviewBusy} className="btn-primary">
                {reviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} I left my review
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">We’ll verify the review was posted before your free month is applied.</p>
          </>
        )}
      </StepCard>

      <StepCard n={2} icon={Video} title="Record a video testimonial" done={videoDone}>
        {videoDone ? (
          <p className="text-sm text-slate-400">Got it, thank you for the testimonial!</p>
        ) : (
          <>
            <p className="text-sm text-slate-400">Hold your phone vertically. Take up to 2 minutes, we’ll give you a 20-second heads-up before it ends. Hit on these specifics, real numbers are what make it land:</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
              <li className="flex gap-2"><span className="text-emerald-400">•</span> How much production or how many cases CaseLift has helped you recover (e.g. “$42k in our first 60 days”).</li>
              <li className="flex gap-2"><span className="text-emerald-400">•</span> How many hours a week it saves your team on follow-up.</li>
              <li className="flex gap-2"><span className="text-emerald-400">•</span> What your follow-up looked like before vs. now, and who you’d recommend it to.</li>
            </ul>
            {/* Vertical (9:16) frame to match how it will be used. */}
            {(phase !== 'idle' || blobUrl) && (
            <div className="relative mx-auto mt-4 aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-xl border border-surface-700 bg-black">
              {blobUrl ? (
                <video src={blobUrl} controls className="h-full w-full object-cover" />
              ) : (
                <video ref={liveRef} className="h-full w-full object-cover" playsInline />
              )}
              {phase === 'countdown' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                  <span className="text-6xl font-bold tabular-nums text-white drop-shadow-lg">{countdownPaused ? '❚❚' : countdown}</span>
                  <span className="mt-1 text-xs font-medium text-white/80">{countdownPaused ? 'Paused' : 'Get ready…'}</span>
                </div>
              )}
              {phase === 'recording' && (
                <>
                  <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
                    <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500/70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" /></span>
                    {fmt(elapsed)}
                  </div>
                  {elapsed >= WARN_AT && (
                    <div className="absolute right-2 top-2 animate-pulse rounded-full bg-amber-500/90 px-2.5 py-1 text-xs font-bold text-black">Ending in {MAX_SECONDS - elapsed}s</div>
                  )}
                </>
              )}
            </div>
            )}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {!blobUrl && phase === 'idle' && (
                <button onClick={beginCountdown} className="btn-primary"><Video className="h-4 w-4" /> Start recording</button>
              )}
              {phase === 'countdown' && (
                <>
                  {countdownPaused ? (
                    <button onClick={() => setCountdownPaused(false)} className="btn-primary"><Play className="h-4 w-4" /> Resume</button>
                  ) : (
                    <button onClick={() => setCountdownPaused(true)} className="btn-ghost"><Pause className="h-4 w-4" /> Pause</button>
                  )}
                  <button onClick={cancelCountdown} className="btn-ghost">Cancel</button>
                </>
              )}
              {phase === 'recording' && (
                <button onClick={stopRecording} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold !text-white transition hover:bg-rose-500"><Square className="h-4 w-4 fill-current" /> Stop</button>
              )}
              {blobUrl && (
                <>
                  <button onClick={resetVideo} className="btn-ghost"><RefreshCcw className="h-4 w-4" /> Re-record</button>
                  <button onClick={submitVideo} disabled={videoBusy} className="btn-primary">
                    {videoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Use this testimonial
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </StepCard>

      <StepCard n={3} icon={UserPlus} title="Tell one friend about CaseLift" done={referralDone}>
        {referralDone ? (
          <p className="text-sm text-slate-400">Invite sent{fm.referral_email ? ` to ${fm.referral_email}` : ''}, thank you for spreading the word!</p>
        ) : (
          <>
            <p className="text-sm text-slate-400">Know another practice that would benefit? Edit the note below and we’ll send it from your account with your referral link attached.</p>
            <div className="mt-3 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className="input flex-1" value={friend.name} onChange={(e) => setFriend((f) => ({ ...f, name: e.target.value }))} placeholder="Friend’s name (optional)" />
                <input className="input flex-1" type="email" value={friend.email} onChange={(e) => setFriend((f) => ({ ...f, email: e.target.value }))} placeholder="friend@theirpractice.com" />
              </div>
              <input className="input" value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} placeholder="Subject" />
              <textarea className="input min-h-[140px] resize-y leading-relaxed" value={draft.message} onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))} placeholder="Your note…" />
              <p className="text-xs text-slate-500">Your CaseLift referral link is added automatically as a button at the bottom of the email.</p>
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={sendReferral} disabled={referralBusy || !friend.email.trim() || !draft.message.trim()} className="btn-primary">
                {referralBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Send invite
              </button>
            </div>
          </>
        )}
      </StepCard>
    </div>
  )
}
