import { createContext, useContext } from 'react'
import { useAuth } from './AuthContext'
import { useTwilioVoiceDevice } from '../lib/voice'

const VoiceContext = createContext(null)

/** Single Twilio Voice device per practice session (outbound + inbound). */
export function VoiceProvider({ children }) {
  const { practiceId, practice } = useAuth()
  const enabled = Boolean(practiceId && practice?.twilio_phone_number)
  const voice = useTwilioVoiceDevice({ enabled })
  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>
}

export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice must be used within VoiceProvider')
  return ctx
}

/** Safe hook for pages outside VoiceProvider (returns null). */
export function useVoiceOptional() {
  return useContext(VoiceContext)
}
