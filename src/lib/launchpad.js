// Launchpad setup checklist — step metadata + status computation.
//
// Most steps are auto-completed by inspecting existing practice data; a couple
// (invite, record) also get checked off the moment the user performs the action.
// The final status is the union of data-derived completion and anything already
// persisted in practice_launchpad_steps.

import { supabase } from './supabase'

// Ordered checklist. `action` tells the Launchpad page what the button does:
//   'invite'        → open the practice invite modal
//   'record'        → open the recorder
//   'kb'            → open the knowledge-base quick form
//   'nav:/path'     → navigate to a route
//   null (auto)     → no action, auto-checked
export const LAUNCHPAD_STEPS = [
  { key: 'account_created', title: 'Account created', description: 'Your CaseLift account is ready to go.', auto: true },
  { key: 'baa_signed', title: 'BAA signed', description: 'Your Business Associate Agreement is on file.', auto: true },
  {
    key: 'team_invited',
    title: 'Invite a team member',
    description: 'Add the person who will record consultations.',
    time: '1 min',
    action: 'invite',
    cta: 'Invite Now',
  },
  {
    key: 'first_consult',
    title: 'Record your first consult',
    description: 'Record a real patient consultation.',
    time: '5 min',
    action: 'record',
    cta: 'Record Now',
  },
  {
    key: 'pms_connected',
    title: 'Connect your PMS',
    description: 'Sync your patient schedule automatically.',
    time: '10 min',
    action: 'nav:/settings/pms',
    cta: 'Connect',
    badge: 'Recommended',
  },
  {
    key: 'a2p_registered',
    title: 'Complete A2P SMS registration',
    description: 'Required to send text messages to patients.',
    time: '5 min',
    action: 'nav:/settings/messaging',
    cta: 'Register',
    badge: 'Required for SMS',
  },
  {
    key: 'notifications_configured',
    title: 'Set up notifications',
    description: 'Get alerted when patients reply.',
    time: '2 min',
    action: 'nav:/settings/notifications',
    cta: 'Set up',
  },
  {
    key: 'knowledge_base_added',
    title: 'Add practice details',
    description: 'Help CaseLift write better follow-up messages.',
    time: '3 min',
    action: 'kb',
    cta: 'Add details',
  },
  {
    key: 'team_complete',
    title: 'Add team members',
    description: 'Invite your full team.',
    time: '2 min',
    action: 'nav:/settings/team',
    cta: 'Invite',
  },
]

export const LAUNCHPAD_STEP_KEYS = LAUNCHPAD_STEPS.map((s) => s.key)
export const LAUNCHPAD_TOTAL = LAUNCHPAD_STEPS.length

// Auto-derive which steps are satisfied by existing data. Returns a Set of keys.
export async function computeAutoComplete(practiceId, practice) {
  const done = new Set(['account_created'])
  if (practice?.baa_accepted_at) done.add('baa_signed')
  if (practice?.sikka_connected || practice?.pms_type) done.add('pms_connected')
  if (practice?.a2p_campaign_status === 'approved') done.add('a2p_registered')
  const prefs = practice?.notification_prefs
  if (prefs && typeof prefs === 'object' && Object.keys(prefs).length > 0) done.add('notifications_configured')

  if (practiceId) {
    const head = { count: 'exact', head: true }
    const [members, consults, kb] = await Promise.all([
      supabase.from('practice_members').select('id', head).eq('practice_id', practiceId),
      supabase.from('consults').select('id', head).eq('practice_id', practiceId),
      supabase.from('practice_knowledge_base').select('id', head).eq('practice_id', practiceId).eq('is_active', true),
    ])
    if ((members.count || 0) > 1) { done.add('team_invited'); done.add('team_complete') }
    if ((consults.count || 0) > 0) done.add('first_consult')
    if ((kb.count || 0) > 0) done.add('knowledge_base_added')
  }
  return done
}

// Full status: union of persisted steps + data-derived completion. Persists any
// newly-derived steps so progress is durable (best-effort). Returns a Set.
export async function loadLaunchpadStatus(practiceId, practice) {
  const auto = await computeAutoComplete(practiceId, practice)
  let persisted = new Set()
  if (practiceId) {
    const { data } = await supabase
      .from('practice_launchpad_steps')
      .select('step_key')
      .eq('practice_id', practiceId)
    persisted = new Set((data || []).map((r) => r.step_key))
  }
  // Persist any auto-derived steps that aren't recorded yet (fire-and-forget).
  const toPersist = [...auto].filter((k) => !persisted.has(k))
  if (practiceId && toPersist.length) {
    void markStepsComplete(practiceId, toPersist)
  }
  return new Set([...auto, ...persisted])
}

// Upsert one or more completed steps (idempotent on practice_id + step_key).
export async function markStepsComplete(practiceId, keys) {
  if (!practiceId || !keys?.length) return
  const rows = keys.map((step_key) => ({ practice_id: practiceId, step_key }))
  await supabase.from('practice_launchpad_steps').upsert(rows, { onConflict: 'practice_id,step_key' })
}

export const launchpadComplete = (doneSet) => LAUNCHPAD_STEP_KEYS.every((k) => doneSet.has(k))
