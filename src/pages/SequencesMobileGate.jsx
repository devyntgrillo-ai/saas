import { GitBranch, Monitor } from 'lucide-react'

// Shown in place of the Sequences page on the native mobile app. Sequence
// timing/pauses/reactivation are intentionally desktop-only for now, so we keep
// the nav tab but route it here instead of the editable management view.
export default function SequencesMobileGate() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
          <GitBranch className="h-6 w-6 text-primary-400" /> Sequences
        </h1>
        <p className="mt-1 text-sm text-slate-400">Manage active follow-up sequences and configure timing</p>
      </div>

      <div className="card flex flex-col items-center px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary-400">
          <Monitor className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-white">Open on desktop to view &amp; edit</h2>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-400">
          Follow-up sequences - timing, pauses, and reactivation campaigns - are managed on the
          desktop app. Sign in to CaseLift on your computer to make changes.
        </p>
      </div>
    </div>
  )
}
