import { useEffect, useRef, useState } from 'react'
import { Gift, Star, Video, UserPlus, Check, Loader2, ExternalLink, Square, RefreshCcw, PartyPopper } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

// Where the "leave a review" button sends people. Swap for your real review link
// (Google Business, Capterra, Trustpilot, etc.).
const REVIEW_URL = 'https://www.trustpilot.com/evaluate/caselift.io'

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

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  // Video recorder state
  const liveRef = useRef(null)
  const recRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const [recording, setRecording] = useState(false)
  const [blob, setBlob] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)

  // Friend form
  const [friend, setFriend] = useState({ name: '', email: '' })

  async function saveFm(patch) {
    const next = { ...(practice?.free_month || {}), ...patch }
    const { error: e } = await supabase.from('practices').update({ free_month: next }).eq('id', practiceId)
    if (e) { setError(e.message); return false }
    await refreshProfile()
    return true
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
    setBusy('review'); setError('')
    await saveFm({ review_at: new Date().toISOString() })
    setBusy('')
  }

  // ── Step 2: video testimonial ───────────────────────────────────────────────
  async function startRecording() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      if (liveRef.current) { liveRef.current.srcObject = stream; liveRef.current.muted = true; liveRef.current.play().catch(() => {}) }
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
      setRecording(true)
    } catch {
      setError('Could not access your camera and microphone. Check browser permissions and try again.')
    }
  }
  function stopRecording() {
    try { recRef.current?.stop() } catch { /* noop */ }
    setRecording(false)
  }
  function resetVideo() {
    setBlob(null)
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    setBlobUrl(null)
  }
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); if (blobUrl) URL.revokeObjectURL(blobUrl) }, [blobUrl])

  async function submitVideo() {
    if (!blob) return
    setBusy('video'); setError('')
    try {
      const path = `${practiceId}/${Date.now()}.webm`
      const { error: upErr } = await supabase.storage.from('testimonials').upload(path, blob, { contentType: blob.type || 'video/webm', upsert: true })
      if (upErr) throw upErr
      await saveFm({ video_at: new Date().toISOString(), video_path: path })
    } catch (e) {
      setError(e?.message || 'Could not upload your video. Please try again.')
    }
    setBusy('')
  }

  // ── Step 3: refer a friend ──────────────────────────────────────────────────
  async function sendReferral() {
    if (!friend.email.trim()) return
    setBusy('referral'); setError('')
    try {
      const { data, error: e } = await supabase.functions.invoke('refer-friend', {
        body: { practice_id: practiceId, friend_name: friend.name.trim(), friend_email: friend.email.trim(), app_origin: window.location.origin },
      })
      if (e || data?.error) throw new Error(data?.error || e?.message || 'Could not send the email.')
      await saveFm({ referral_at: new Date().toISOString(), referral_email: friend.email.trim() })
    } catch (err) {
      setError(err?.message || 'Could not send the email. Please try again.')
    }
    setBusy('')
  }

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

      <StepCard n={1} icon={Star} title="Leave a review" done={reviewDone}>
        {reviewDone ? (
          <p className="text-sm text-slate-400">Thanks for the review!</p>
        ) : (
          <>
            <p className="text-sm text-slate-400">A quick, honest review helps other practices find CaseLift. It only takes a minute.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={REVIEW_URL} target="_blank" rel="noreferrer" className="btn-ghost"><ExternalLink className="h-4 w-4" /> Open review page</a>
              <button onClick={markReview} disabled={busy === 'review'} className="btn-primary">
                {busy === 'review' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} I left my review
              </button>
            </div>
          </>
        )}
      </StepCard>

      <StepCard n={2} icon={Video} title="Record a quick video testimonial" done={videoDone}>
        {videoDone ? (
          <p className="text-sm text-slate-400">Got it — thank you for the testimonial!</p>
        ) : (
          <>
            <p className="text-sm text-slate-400">15–30 seconds on how CaseLift has helped your practice. Record right here.</p>
            <div className="mt-3 overflow-hidden rounded-xl border border-surface-700 bg-black">
              {blobUrl ? (
                <video src={blobUrl} controls className="h-56 w-full bg-black" />
              ) : (
                <video ref={liveRef} className="h-56 w-full bg-black" playsInline />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!blobUrl && !recording && (
                <button onClick={startRecording} className="btn-primary"><Video className="h-4 w-4" /> Start recording</button>
              )}
              {recording && (
                <button onClick={stopRecording} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold !text-white transition hover:bg-rose-500"><Square className="h-4 w-4 fill-current" /> Stop</button>
              )}
              {blobUrl && (
                <>
                  <button onClick={resetVideo} className="btn-ghost"><RefreshCcw className="h-4 w-4" /> Re-record</button>
                  <button onClick={submitVideo} disabled={busy === 'video'} className="btn-primary">
                    {busy === 'video' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Use this testimonial
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </StepCard>

      <StepCard n={3} icon={UserPlus} title="Tell one friend about CaseLift" done={referralDone}>
        {referralDone ? (
          <p className="text-sm text-slate-400">Invite sent{fm.referral_email ? ` to ${fm.referral_email}` : ''} — thank you for spreading the word!</p>
        ) : (
          <>
            <p className="text-sm text-slate-400">Know another practice that would benefit? We’ll send them a friendly intro on your behalf.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input className="input flex-1" value={friend.name} onChange={(e) => setFriend((f) => ({ ...f, name: e.target.value }))} placeholder="Friend’s name (optional)" />
              <input className="input flex-1" type="email" value={friend.email} onChange={(e) => setFriend((f) => ({ ...f, email: e.target.value }))} placeholder="friend@theirpractice.com" />
              <button onClick={sendReferral} disabled={busy === 'referral' || !friend.email.trim()} className="btn-primary shrink-0">
                {busy === 'referral' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Send
              </button>
            </div>
          </>
        )}
      </StepCard>
    </div>
  )
}
