import PhoneSetupWizard from './PhoneSetupWizard'

/** Agency modal wrapper around the shared phone setup wizard. */
export default function PhoneSetupModal({ practiceId, practiceName, onClose, onDone }) {
  return (
    <PhoneSetupWizard
      practiceId={practiceId}
      practiceName={practiceName}
      onClose={onClose}
      onComplete={onDone}
    />
  )
}
