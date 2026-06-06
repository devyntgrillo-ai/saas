import { Mic } from 'lucide-react'
import { useRecorder } from '../context/RecorderContext'

// Sidebar call-to-action that launches the patient-assignment -> recording flow.
// Replaces the old floating button; same openRecorder() entry point.
export default function RecordConsultButton({ onLaunch }) {
  const { openRecorder } = useRecorder()
  return (
    <div className="px-3 pb-3 pt-6">
      <button
        onClick={() => {
          openRecorder()
          onLaunch?.()
        }}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary)] px-3 text-sm font-semibold !text-white transition hover:bg-[var(--brand-primary-hover)]"
      >
        <Mic className="h-4 w-4 shrink-0" />
        Record Consult
      </button>
    </div>
  )
}
