import { Circle, Loader2, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useVoiceOptional } from '../context/VoiceContext'
import { formatCallTime } from '../lib/voice'

function formatPhone(raw) {
  if (!raw) return 'Unknown caller'
  const d = String(raw).replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return raw
}

/** Global incoming + active call bar (fixed bottom). */
export default function VoiceCallBar() {
  const voice = useVoiceOptional()
  const navigate = useNavigate()
  const location = useLocation()
  if (!voice || voice.callState === 'idle') return null

  // Power Dialer has its own in-call bar for outbound sessions.
  const onDialer = location.pathname === '/conversations/dialer'
  if (onDialer && voice.callState !== 'incoming') return null

  if (voice.callState === 'incoming') {
    return (
      <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-rose-300 bg-rose-50 px-4 py-3 shadow-lg">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white">
              <PhoneIncoming className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-rose-900">Incoming call</p>
              <p className="truncate text-sm text-rose-700">{formatPhone(voice.incomingFrom)}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => voice.rejectIncoming()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100"
            >
              <X className="h-4 w-4" /> Decline
            </button>
            <button
              type="button"
              onClick={() => {
                const convId = voice.incomingMeta?.conversationId
                if (convId) navigate(`/conversations?c=${convId}`)
                voice.acceptIncoming()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              <Phone className="h-4 w-4" /> Answer
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isInbound = voice.callDirection === 'inbound'
  const label =
    voice.callState === 'in_call'
      ? isInbound
        ? 'Inbound call'
        : 'Recording'
      : voice.callState === 'ringing'
        ? 'Ringing…'
        : 'Connecting…'

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-emerald-200 bg-emerald-50 px-4 py-3 shadow-lg">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-emerald-800">
          {voice.callState === 'in_call' ? (
            <>
              <Circle className="h-2 w-2 animate-pulse fill-rose-500 text-rose-500" />
              {label} · {formatCallTime(voice.seconds)}
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
              {label}
            </>
          )}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={voice.toggleMute}
            disabled={voice.callState !== 'in_call'}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-900 disabled:opacity-40"
          >
            {voice.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {voice.muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            onClick={voice.hangup}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
          >
            <PhoneOff className="h-3.5 w-3.5" /> End call
          </button>
        </div>
      </div>
    </div>
  )
}
