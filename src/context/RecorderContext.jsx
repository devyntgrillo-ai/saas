import { createContext, useCallback, useContext, useState } from 'react'
import AssignmentModal from '../components/AssignmentModal'
import RecordingModal from '../components/RecordingModal'

const RecorderContext = createContext({ openRecorder: () => {}, closeRecorder: () => {} })

// Recording always begins with patient assignment: openRecorder() shows the
// AssignmentModal (pick a today's appointment or enter a new patient); once a
// patient is confirmed, the RecordingModal opens with that patient in hand.
// openRecorder(presetAppointment) skips appointment selection (used by the
// Consults page "Start Recording" button, which already has the appointment).
export function RecorderProvider({ children }) {
  const [assigning, setAssigning] = useState(null) // null | { presetAppointment }
  const [patient, setPatient] = useState(null)

  const openRecorder = useCallback((presetAppointment = null) => {
    setPatient(null)
    setAssigning({ presetAppointment: presetAppointment || null })
  }, [])
  const closeRecorder = useCallback(() => {
    setAssigning(null)
    setPatient(null)
  }, [])

  return (
    <RecorderContext.Provider value={{ openRecorder, closeRecorder }}>
      {children}
      {assigning && (
        <AssignmentModal
          presetAppointment={assigning.presetAppointment}
          onCancel={closeRecorder}
          onConfirm={(p) => { setAssigning(null); setPatient(p) }}
        />
      )}
      {patient && <RecordingModal patient={patient} onClose={() => setPatient(null)} />}
    </RecorderContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRecorder() {
  return useContext(RecorderContext)
}
