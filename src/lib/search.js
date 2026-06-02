// Global search across consults and conversations for the Cmd+K palette.
import { supabase } from './supabase'
import { objectionMeta, statusMeta } from './consults'

// Runs two scoped queries and shapes results into navigable items.
export async function globalSearch(practiceId, term) {
  const q = term.trim()
  if (!practiceId || !q) return { consults: [], conversations: [] }

  const like = `%${q}%`
  const [{ data: consults }, { data: conversations }] = await Promise.all([
    supabase
      .from('consults')
      .select('id, recording_date, status, objection_type, patient_name')
      .eq('practice_id', practiceId)
      .or(`patient_name.ilike.${like},objection_type.ilike.${like},status.ilike.${like}`)
      .order('recording_date', { ascending: false })
      .limit(6),
    supabase
      .from('conversations')
      .select('id, patient_first, patient_last, patient_phone, patient_email')
      .eq('practice_id', practiceId)
      .or(
        `patient_first.ilike.${like},patient_last.ilike.${like},patient_phone.ilike.${like},patient_email.ilike.${like}`
      )
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(6),
  ])

  return {
    consults: (consults || []).map((c) => ({
      id: c.id,
      title: c.patient_name || 'Consult (awaiting approval)',
      subtitle: [statusMeta(c.status).label, c.objection_type && objectionMeta(c.objection_type).label]
        .filter(Boolean)
        .join(' · '),
      to: `/consults/${c.id}`,
    })),
    conversations: (conversations || []).map((c) => ({
      id: c.id,
      title: [c.patient_first, c.patient_last].filter(Boolean).join(' ') || 'Patient',
      subtitle: c.patient_phone || c.patient_email || '',
      to: `/conversations?c=${c.id}`,
    })),
  }
}
