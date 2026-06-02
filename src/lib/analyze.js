// Client helper to analyze a consult transcript.
//
// IMPORTANT: transcripts may contain PHI. The browser NEVER sends a transcript
// to the Claude API directly. It is sent only to our `analyze-consult` edge
// function, which strips PHI (local regex) before any analysis and stores only
// the de-identified version.
import { supabase } from './supabase'

export async function analyzeConsult({ transcript, consultId, recordingDate, recordingTime, duration }) {
  const { data, error } = await supabase.functions.invoke('analyze-consult', {
    body: {
      transcript,
      consult_id: consultId,
      recording_date: recordingDate,
      recording_time: recordingTime,
      duration,
    },
  })
  if (error) throw error
  return data
}
