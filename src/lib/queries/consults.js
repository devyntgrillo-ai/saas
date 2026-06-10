import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { queryKeys } from './keys'

// A consult is "processing" until analysis + message drafting finish (status
// flips to 'analyzed'). 'analyzing' = transcribing, 'transcribed' = analysis in
// progress. transcription_error is surfaced on the detail page, not here.
export const PROCESSING_STATUSES = ['analyzing', 'transcribed']

// A healthy consult goes analyzing → transcribed → analyzed within minutes.
// Anything still "processing" after this window is an abandoned recording (the
// placeholder row created at record-start whose upload/transcription never
// finished), age it out of the processing cards/dashboard so it doesn't show
// as "being analyzed" forever. The row still appears in the normal Consults
// list; it just stops claiming to be in progress.
export const PROCESSING_MAX_AGE_MS = 2 * 60 * 60 * 1000 // 2 hours

const TYPE_RE = /consult|implant/i

export async function fetchDayAppointments(practiceId, date) {
  if (!practiceId) return { appts: [], allNote: false }

  const start = new Date(`${date}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  const { data, error } = await supabase
    .from('pms_appointments')
    .select('*')
    .eq('practice_id', practiceId)
    .gte('appointment_time', start.toISOString())
    .lt('appointment_time', end.toISOString())
    .order('appointment_time', { ascending: true })

  if (error) throw error

  const rows = data || []
  const consultRows = rows.filter((a) => TYPE_RE.test(a.appointment_type || ''))
  if (consultRows.length === 0 && rows.length > 0) {
    return { appts: rows, allNote: true }
  }
  return { appts: consultRows, allNote: false }
}

export async function fetchUnlinkedConsults(practiceId) {
  if (!practiceId) return []
  const { data, error } = await supabase
    .from('consults')
    .select('id, patient_name, status, created_at')
    .eq('practice_id', practiceId)
    .is('appointment_id', null)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data || []
}

// Consult-type appointments over the next `days` days (starting tomorrow), 
// powers the "Upcoming" section of the Schedule tab. Today is handled separately
// by fetchDayAppointments so its allNote fallback stays intact.
export async function fetchUpcomingAppointments(practiceId, days = 7) {
  if (!practiceId) return []
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() + 1) // tomorrow
  const end = new Date(start)
  end.setDate(end.getDate() + days)

  const { data, error } = await supabase
    .from('pms_appointments')
    .select('*')
    .eq('practice_id', practiceId)
    .gte('appointment_time', start.toISOString())
    .lt('appointment_time', end.toISOString())
    .order('appointment_time', { ascending: true })
  if (error) throw error

  const rows = data || []
  const consultRows = rows.filter((a) => TYPE_RE.test(a.appointment_type || ''))
  // Mirror the day view: if nothing is consult-typed but there are appointments,
  // show them all rather than an empty upcoming list.
  return consultRows.length === 0 && rows.length > 0 ? rows : consultRows
}

export function useUpcomingAppointments(practiceId) {
  return useQuery({
    queryKey: queryKeys.upcomingConsults(practiceId),
    queryFn: () => fetchUpcomingAppointments(practiceId),
    enabled: Boolean(practiceId),
  })
}

// The next N upcoming consult appointments from now onward, regardless of how far
// out they are, sorted earliest first. Used so the Schedule tab is never empty.
export async function fetchNextConsults(practiceId, limit = 5) {
  if (!practiceId) return []
  // From the start of tomorrow onward, so these never duplicate today's rows
  // (which already render in the day table above).
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() + 1)
  const { data, error } = await supabase
    .from('pms_appointments')
    .select('*')
    .eq('practice_id', practiceId)
    .gte('appointment_time', start.toISOString())
    .order('appointment_time', { ascending: true })
    .limit(50)
  if (error) throw error
  const rows = data || []
  const consultRows = rows.filter((a) => TYPE_RE.test(a.appointment_type || ''))
  // Mirror the day/upcoming views: if nothing is consult-typed, fall back to all.
  const chosen = consultRows.length === 0 && rows.length > 0 ? rows : consultRows
  return chosen.slice(0, limit)
}

export function useNextConsults(practiceId, limit = 5) {
  return useQuery({
    queryKey: [...queryKeys.upcomingConsults(practiceId), 'next', limit],
    queryFn: () => fetchNextConsults(practiceId, limit),
    enabled: Boolean(practiceId),
  })
}

export function useConsultsDay(practiceId, date) {
  return useQuery({
    queryKey: queryKeys.consultsDay(practiceId, date),
    queryFn: () => fetchDayAppointments(practiceId, date),
    enabled: Boolean(practiceId && date),
  })
}

export function useUnlinkedConsults(practiceId) {
  return useQuery({
    queryKey: queryKeys.unlinkedConsults(practiceId),
    queryFn: () => fetchUnlinkedConsults(practiceId),
    enabled: Boolean(practiceId),
  })
}

// Consults currently being transcribed/analyzed for this practice, surfaced as
// "processing" cards at the top of the Consults list and as the dashboard count.
export async function fetchProcessingConsults(practiceId) {
  if (!practiceId) return []
  const cutoff = new Date(Date.now() - PROCESSING_MAX_AGE_MS).toISOString()
  const { data, error } = await supabase
    .from('consults')
    .select('id, patient_name, patient_first, patient_last, treatment_type, status, created_at')
    .eq('practice_id', practiceId)
    .in('status', PROCESSING_STATUSES)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(25)
  if (error) throw error
  return data || []
}

export function useProcessingConsults(practiceId) {
  return useQuery({
    queryKey: queryKeys.processingConsults(practiceId),
    queryFn: () => fetchProcessingConsults(practiceId),
    enabled: Boolean(practiceId),
    // Light poll as a fallback in case realtime isn't enabled on the consults
    // table; realtime (useConsultsRealtime) invalidates this immediately.
    refetchInterval: 15000,
  })
}

// A consult whose analysis just finished, surfaced as a "complete" card in the
// Consults list so a freshly-recorded consult doesn't vanish when it leaves the
// processing state. 'analyzed' = ready to review; 'transcription_error' = failed.
// (Once the user approves/activates the sequence the consult moves on to the
// Sequences list, so we only keep recent ones here.)
export const RECENT_DONE_STATUSES = ['analyzed', 'transcription_error']
export const RECENT_DONE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function fetchRecentConsults(practiceId) {
  if (!practiceId) return []
  const cutoff = new Date(Date.now() - RECENT_DONE_MAX_AGE_MS).toISOString()
  const { data, error } = await supabase
    .from('consults')
    .select('id, patient_name, patient_first, patient_last, treatment_type, status, appointment_id, created_at')
    .eq('practice_id', practiceId)
    .in('status', RECENT_DONE_STATUSES)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(25)
  if (error) throw error
  return data || []
}

export function useRecentConsults(practiceId) {
  return useQuery({
    queryKey: queryKeys.recentConsults(practiceId),
    queryFn: () => fetchRecentConsults(practiceId),
    enabled: Boolean(practiceId),
    refetchInterval: 30000,
  })
}

// The persistent, searchable archive of every recorded consult for a practice, 
// powers the paginated "Recordings" list on the Consults page. Excludes the
// in-progress / empty placeholder states (those live in the processing cards).
export const ARCHIVE_PAGE_SIZE = 20
const ARCHIVE_EXCLUDED = '("analyzing","transcribed","new")'

export async function fetchConsultArchive(practiceId, { search = '', page = 0, pageSize = ARCHIVE_PAGE_SIZE } = {}) {
  if (!practiceId) return { rows: [], total: 0 }
  const from = page * pageSize
  let q = supabase
    .from('consults')
    .select(
      'id, patient_name, patient_first, patient_last, treatment_type, status, created_at, recording_date, duration',
      { count: 'exact' }
    )
    .eq('practice_id', practiceId)
    .not('status', 'in', ARCHIVE_EXCLUDED)
  const s = search.trim().replace(/[%,()]/g, ' ').trim() // strip chars that break the or() filter
  if (s) {
    q = q.or(`patient_name.ilike.%${s}%,patient_first.ilike.%${s}%,patient_last.ilike.%${s}%`)
  }
  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)
  if (error) throw error
  return { rows: data || [], total: count || 0 }
}

export function useConsultArchive(practiceId, search, page) {
  return useQuery({
    queryKey: queryKeys.consultArchive(practiceId, search, page),
    queryFn: () => fetchConsultArchive(practiceId, { search, page }),
    enabled: Boolean(practiceId),
    placeholderData: (prev) => prev, // keep the current page visible while the next loads
  })
}

// Realtime: when any consult for this practice changes status, refresh the
// processing list + the day/sequences/dashboard views so processing cards
// transition to "ready" without a manual reload. Falls back to the poll above
// if the consults table isn't in the realtime publication yet.
export function useConsultsRealtime(practiceId) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!practiceId) return
    const channel = supabase
      .channel(`consults-status:${practiceId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consults', filter: `practice_id=eq.${practiceId}` },
        () => {
          // A consult changed status, refresh every view that renders one so a
          // processing card transitions to its "complete" state (and the real
          // sequence row appears) without a manual reload.
          queryClient.invalidateQueries({ queryKey: queryKeys.processingConsults(practiceId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.recentConsults(practiceId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.unlinkedConsults(practiceId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(practiceId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.sequences(practiceId) })
          queryClient.invalidateQueries({ queryKey: queryKeys.sequenceActiveCount(practiceId) })
          // consultsDay's key carries the viewed date, so match by prefix.
          queryClient.invalidateQueries({
            predicate: (q) =>
              q.queryKey[0] === 'practice' &&
              q.queryKey[1] === practiceId &&
              q.queryKey[2] === 'consults-day',
          })
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [practiceId, queryClient])
}
