// Reactivation campaigns: targeted drip outreach to patients with accepted
// treatment plans who never scheduled. This module owns the angle templates,
// the audience query + filters, the cost/timeline estimators, and all
// campaign/enrollment persistence. The drip itself runs server-side
// (process-reactivation-drip); the same step model is mirrored there.
import { supabase } from './supabase'
import { DEFAULT_TREATMENT } from './treatments'

const DAY_MS = 86400000

// A short, lowercase noun phrase for a treatment, used inside message copy
// (e.g. "implant", "Invisalign", "veneers"). Falls back to generic
// "treatment" language so campaigns read naturally for any treatment type -
// or for the cross-treatment "all" case.
const TREATMENT_TERMS = {
  dental_implants: 'dental implant',
  full_arch: 'full-arch',
  invisalign: 'Invisalign',
  cosmetic_veneers: 'veneer',
  sleep_apnea: 'sleep apnea',
  periodontal: 'periodontal',
  full_mouth_rehab: 'full-mouth',
  other: 'treatment',
}

/** Lowercase term for message copy. `all`/unknown → generic "treatment". */
export function treatmentTerm(treatmentType) {
  if (!treatmentType || treatmentType === 'all') return 'treatment'
  return TREATMENT_TERMS[treatmentType] || 'treatment'
}
const SMS_RATE = 0.0075 // approx Twilio per-SMS, used for the cost estimate

// ----------------------------------------------------------------------------
// Date-range buckets (consult age). min = newest allowed, max = oldest allowed.
// Hard floor of 2 weeks (never blast patients still in their initial sequence)
// and a 24-month ceiling (older than that they're too cold).
// ----------------------------------------------------------------------------
export const DATE_RANGES = [
  { key: '2w_1m', label: '2 weeks - 1 month', minDays: 14, maxDays: 30 },
  { key: '1_3m', label: '1 - 3 months', minDays: 30, maxDays: 90 },
  { key: '3_6m', label: '3 - 6 months', minDays: 90, maxDays: 180 },
  { key: '6_12m', label: '6 - 12 months', minDays: 180, maxDays: 365 },
  { key: '12_24m', label: '12 - 24 months', minDays: 365, maxDays: 730 },
]
export const DEFAULT_RANGE = '6_12m'

// Convert a bucket into absolute consult-date boundaries.
export function rangeBoundaries(key) {
  const r = DATE_RANGES.find((x) => x.key === key) || DATE_RANGES.find((x) => x.key === DEFAULT_RANGE)
  const now = Date.now()
  return {
    // newest allowed consult date (most recent)
    filter_date_min: new Date(now - r.minDays * DAY_MS).toISOString(),
    // oldest allowed consult date
    filter_date_max: new Date(now - r.maxDays * DAY_MS).toISOString(),
  }
}

export const OBJECTION_FILTERS = ['all', 'price', 'fear', 'spouse', 'timing']
export const EXIT_INTENT_FILTERS = ['all', 'hot', 'warm', 'long_term']

// ----------------------------------------------------------------------------
// Angle templates. [Last]/[TC name]/[date] are practice-level and pre-filled
// when the builder loads. [Name] stays a token and is replaced per-recipient at
// send time (fillName). Each angle is three ordered sends: SMS 1, Email 1, SMS 2.
// ----------------------------------------------------------------------------
export const ANGLE_META = {
  price_lock: {
    key: 'price_lock',
    name: 'Price Lock',
    recommended: true,
    headline: "Lock in today's pricing before it changes",
    description: 'Hold their quoted price for a window and nudge them to move before treatment costs rise.',
  },
  check_in: {
    key: 'check_in',
    name: 'Check In',
    recommended: false,
    headline: 'A personal check-in from the doctor',
    description: 'Warm, no-pressure note from the doctor. Best for fear or long-term intent patients.',
  },
  new_option: {
    key: 'new_option',
    name: 'New Option',
    recommended: false,
    headline: 'We have a new solution that might work better for you',
    description: 'Introduce an alternative (financing, phased treatment, downsell) tied to their objection.',
  },
}

export const ANGLE_ORDER = ['price_lock', 'check_in', 'new_option']

// Build the three angles with practice tokens filled in. Returns an object keyed
// by angle, each with message fields mapped to the campaign columns.
export function buildAngles({ doctorLast = 'the doctor', tcName = 'our team', holdDate = '', treatmentType = 'all' } = {}) {
  const L = doctorLast
  const D = holdDate
  const TC = tcName
  const term = treatmentTerm(treatmentType) // e.g. "Invisalign", "veneer", "treatment"
  return {
    price_lock: {
      message_1_sms: `Hi [Name], Dr. ${L} here. We wanted to reach out, we're holding your treatment plan pricing through ${D}. A lot has changed in ${term} costs lately and we wanted to make sure you had the opportunity to move forward at the price we quoted. Reply if you'd like more info.`,
      message_1_email_subject: `Your treatment plan, a note from Dr. ${L}`,
      message_1_email_body: `Hi [Name],\n\nI wanted to personally reach out about your treatment plan. ${term.charAt(0).toUpperCase() + term.slice(1)} costs have been rising across the board, and I'd hate for that to be the reason you wait.\n\nWe're holding the pricing we quoted you through ${D}. Your plan is still ready to go whenever you are, and we have flexible financing options that can spread the investment into comfortable monthly payments.\n\nIf you have any questions at all, just reply to this email or give us a call. No pressure, I simply want to make sure you have everything you need to make the right decision for you.\n\nWarmly,\nDr. ${L}`,
      message_2_sms: `Hi [Name], just wanted to make sure you got my note. We have a few openings coming up and I'd love to get you on the schedule. No pressure at all, just want to make sure you have all the info. -Dr. ${L}`,
    },
    check_in: {
      message_1_sms: `Hi [Name], Dr. ${L} here. I was reviewing some of our consultation notes and wanted to personally check in, how are you doing? Have you had a chance to think more about your smile? We're here whenever you're ready.`,
      message_1_email_subject: `Checking in, [Name]`,
      message_1_email_body: `Hi [Name],\n\nI was going back through some of our consultation notes and your name came up, so I wanted to take a moment to personally check in.\n\nHow have you been? I know life gets busy and these decisions take time, and there's absolutely no pressure here. I just wanted you to know we're still thinking of you and we're here whenever you feel ready to pick the conversation back up.\n\nIf you'd ever like to come in for a no-pressure follow-up, or even just have a question, reply to this note or give us a call anytime.\n\nWarmly,\nDr. ${L}`,
      message_2_sms: `Hi [Name], no pressure at all, just wanted you to know we're still here and thinking of you. If you ever have questions or want to come back in, we'd love to see you. -Dr. ${L}`,
    },
    new_option: {
      message_1_sms: `Hi [Name], this is ${TC} from Dr. ${L}'s office. We've been working with some patients in similar situations to yours and found a treatment approach that might be a better fit. Would you be open to a quick 10-minute call this week?`,
      message_1_email_subject: `A new option for your smile, from Dr. ${L}`,
      message_1_email_body: `Hi [Name],\n\nI'm reaching out because we've recently started helping patients in situations a lot like yours with a different approach that might be a better fit for you.\n\nDepending on what's holding you back, that could mean phased treatment to spread things out, new financing options, or a more conservative starting point that still gets you moving toward the result you want.\n\nI'd love to walk you through it on a quick, free consultation call, just 10 minutes, no obligation. Reply here or call us and we'll find a time that works.\n\nTalk soon,\n${TC}\nDr. ${L}'s office`,
      message_2_sms: `Hi [Name], just following up on my message. Dr. ${L} has helped several patients in similar situations find a path forward. We'd love to chat even just for 10 minutes. Reply YES and we'll find a time. -${TC}`,
    },
  }
}

// ----------------------------------------------------------------------------
// Treatment-aware angle templates for the inline campaign builder (Sequences
// page). Same three angles as ANGLE_META, but shaped as an array with the
// FIRSTNAME/LASTNAME tokens and field names the builder + launch() expect.
// Copy adapts to the selected treatment; "all" yields generic high-value
// treatment language. Use the "Customize" path in the UI for full edits.
// ----------------------------------------------------------------------------
export function buildCampaignAngles(treatmentType = 'all') {
  const term = treatmentTerm(treatmentType) // lowercase noun, e.g. "Invisalign", "treatment"
  const Term = term.charAt(0).toUpperCase() + term.slice(1)
  const isAll = !treatmentType || treatmentType === 'all'
  // A friendly phrase for what the patient was considering.
  const planPhrase = isAll ? 'treatment plan' : `${term} treatment plan`
  return [
    {
      key: 'price_lock', name: 'Price Lock', recommended: true,
      desc: `Hold their ${planPhrase} pricing before costs rise.`,
      sms1: `Hi FIRSTNAME, Dr. LASTNAME here. We're holding your ${planPhrase} pricing for 30 days before costs increase. I'd hate for you to miss this. Reply if you'd like more info.`,
      email_subject: 'Your treatment plan - a note from Dr. LASTNAME',
      email_body: `Hi FIRSTNAME, I was reviewing your ${planPhrase} and wanted to reach out personally. ${Term} costs have been rising, so we are holding your pricing for the next 30 days. Here is a quick financing breakdown so you can see how affordable monthly options can be. No pressure at all - just did not want you to miss the window.`,
      sms2: "Hi FIRSTNAME - just making sure you got my note. We have a few openings and I'd love to get you scheduled. No pressure. -Dr. LASTNAME",
    },
    {
      key: 'personal', name: 'Personal Check-In',
      desc: 'Warm, no hard sell.',
      sms1: 'Hi FIRSTNAME, Dr. LASTNAME here. I was reviewing notes from your visit and wanted to personally check in - how are you doing? We are here whenever you are ready.',
      email_subject: 'Checking in on you, FIRSTNAME',
      email_body: `Hi FIRSTNAME, no agenda here - I just wanted to check in and see how you are doing. Your ${isAll ? 'health and comfort' : `${term} treatment`} matters to us, and whenever the timing feels right, we would love to help. Reply anytime with questions.`,
      sms2: 'Hi FIRSTNAME - no pressure at all. Just want you to know we are thinking of you and here when you are ready. -Dr. LASTNAME',
    },
    {
      key: 'new_option', name: 'New Option',
      desc: 'Introduce an alternative approach.',
      sms1: "Hi FIRSTNAME, this is the team at Dr. LASTNAME's office. We've found a treatment approach that might work better for your situation. Would you be open to a quick 10-min call?",
      email_subject: 'A new option for you - Dr. LASTNAME',
      email_body: `Hi FIRSTNAME, we have been thinking about your ${planPhrase} and have an alternative approach that may fit better - whether that is phased treatment or a different financing path. Dr. LASTNAME has helped patients in similar situations find a path forward. Would a quick consultation call help?`,
      sms2: 'Hi FIRSTNAME - following up on my message. Reply YES for a quick call. -Dr. LASTNAME',
    },
  ]
}

// Practice tokens from auth context (practice + profile records).
export function practiceTokens(practice, profile) {
  const doctorLast = practice?.doctor_last || practice?.name?.split(' ')?.[0] || 'the doctor'
  const tcName =
    profile?.full_name ||
    profile?.name ||
    practice?.sms_sender_name ||
    (profile?.email ? profile.email.split('@')[0] : '') ||
    'our team'
  // Price-lock hold date: ~30 days out, written as "Month Day".
  const holdDate = new Date(Date.now() + 30 * DAY_MS).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  return { doctorLast, tcName, holdDate }
}

// Replace the per-recipient [Name] token (and common variants) at send time.
export function fillName(text, first) {
  if (!text) return ''
  return String(text).replace(/\[Name\]|\[name\]|\[first_name\]|\{\{first_name\}\}/g, first || 'there')
}

const hasText = (v) => Boolean((v ?? '').toString().trim())

// Canonical ordered steps for a campaign row (skips empty slots). The drip uses
// the step at index === messages_sent. Mirrored in process-reactivation-drip.
export function campaignSteps(c) {
  const steps = []
  if (hasText(c.message_1_sms)) steps.push({ channel: 'sms', label: 'SMS 1', body: c.message_1_sms })
  if (hasText(c.message_1_email_body) || hasText(c.message_1_email_subject)) {
    steps.push({ channel: 'email', label: 'Email 1', subject: c.message_1_email_subject, body: c.message_1_email_body })
  }
  if (hasText(c.message_2_sms)) steps.push({ channel: 'sms', label: 'SMS 2', body: c.message_2_sms })
  if (hasText(c.message_2_email_body) || hasText(c.message_2_email_subject)) {
    steps.push({ channel: 'email', label: 'Email 2', subject: c.message_2_email_subject, body: c.message_2_email_body })
  }
  if (hasText(c.message_3_sms)) steps.push({ channel: 'sms', label: 'SMS 3', body: c.message_3_sms })
  return steps
}

// ----------------------------------------------------------------------------
// Audience query. Candidates are unconverted consults inside the date window
// with a treatment-plan value. We embed messages so the caller can flag patients
// already in an active sequence (auto-excluded, shown greyed out).
// ----------------------------------------------------------------------------
const PENDING_MSG = ['draft', 'scheduled', 'pending']

export async function fetchCandidates(practiceId, { range = DEFAULT_RANGE, objection = 'all', exitIntent = 'all', treatmentType = 'all' } = {}) {
  if (!practiceId) return []
  const { filter_date_min, filter_date_max } = rangeBoundaries(range)
  let q = supabase
    .from('consults')
    .select(
      'id, patient_first, patient_last, patient_name, patient_phone, patient_email, treatment_type, objection_type, primary_objection, exit_intent_level, exit_intent, case_value, status, outcome, sequence_cancelled_at, created_at, messages(status)'
    )
    .eq('practice_id', practiceId)
    .lte('created_at', filter_date_min)
    .gte('created_at', filter_date_max)
    // Exclude patients who already converted or were marked accepted.
    .not('status', 'in', '(closed_won,recovered)')
    .order('created_at', { ascending: false })

  if (objection !== 'all') q = q.eq('objection_type', objection)
  if (exitIntent !== 'all') q = q.eq('exit_intent_level', exitIntent)
  if (treatmentType && treatmentType !== 'all') q = q.eq('treatment_type', treatmentType)

  const { data, error } = await q
  if (error) {
    console.error('fetchCandidates error', error)
    return []
  }
  return (data || [])
    .filter((c) => c.outcome !== 'accepted' && c.outcome !== 'closed_won')
    .map((c) => {
      const msgs = c.messages || []
      const activeSequence =
        !c.sequence_cancelled_at &&
        (c.outcome === 'pending' || !c.outcome) &&
        msgs.some((m) => PENDING_MSG.includes(m.status))
      return {
        consult_id: c.id,
        treatment_type: c.treatment_type || DEFAULT_TREATMENT,
        patient_first: c.patient_first || (c.patient_name || '').split(' ')[0] || '',
        patient_last: c.patient_last || (c.patient_name || '').split(' ').slice(1).join(' ') || '',
        patient_phone: c.patient_phone || '',
        patient_email: c.patient_email || '',
        objection: c.objection_type || c.primary_objection || '',
        exit_intent: c.exit_intent_level || c.exit_intent || '',
        case_value: c.case_value || 0,
        consult_date: c.created_at,
        activeSequence,
      }
    })
}

// ----------------------------------------------------------------------------
// Estimators
// ----------------------------------------------------------------------------
export function estimateCost(totalMessages) {
  // Spec models the estimate as total messages at the SMS rate.
  return Math.round(totalMessages * SMS_RATE * 100) / 100
}

export function estimateDays(totalMessages, perDay) {
  if (!perDay) return 0
  return Math.max(1, Math.round(totalMessages / perDay))
}

// Day-by-day projection of the drip. Each recipient advances one step per day
// (after a one-day gap); new recipients enter at perDay rate and take priority,
// then remaining budget advances in-flight recipients.
export function projectTimeline({ recipientCount, stepCount, perDay, maxDays = 10 }) {
  if (!recipientCount || !stepCount || !perDay) return []
  // progress[i] = number of steps already sent to recipient i
  const progress = new Array(recipientCount).fill(0)
  const lastDay = new Array(recipientCount).fill(-1)
  const rows = []
  let day = 0
  const allDone = () => progress.every((p) => p >= stepCount)
  while (!allDone() && day < 1000) {
    day++
    let budget = perDay
    const tally = {} // stepIndex -> count
    // Pass 1: start brand-new recipients (step 0).
    for (let i = 0; i < recipientCount && budget > 0; i++) {
      if (progress[i] === 0 && lastDay[i] < 0) {
        tally[0] = (tally[0] || 0) + 1
        progress[i] = 1
        lastDay[i] = day
        budget--
      }
    }
    // Pass 2: advance in-flight recipients whose last send was a previous day.
    for (let i = 0; i < recipientCount && budget > 0; i++) {
      if (progress[i] > 0 && progress[i] < stepCount && lastDay[i] < day) {
        const idx = progress[i]
        tally[idx] = (tally[idx] || 0) + 1
        progress[i] = idx + 1
        lastDay[i] = day
        budget--
      }
    }
    if (day <= maxDays) {
      rows.push({ day, tally })
    }
  }
  return { rows, totalDays: day }
}

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------

// Create the campaign + one enrollment per selected recipient. `start` = 'now'
// or 'scheduled'. Returns the campaign row.
export async function createCampaign({
  practiceId,
  campaignName,
  angleType,
  messages,
  range,
  recipients,
  messagesPerDay,
  sendWindowStart = 9,
  sendWindowEnd = 17,
  sendDays = 'mon_fri',
  scheduledStart,
  start = 'scheduled',
}) {
  const { filter_date_min, filter_date_max } = rangeBoundaries(range)
  const nowIso = new Date().toISOString()
  const status = start === 'now' ? 'active' : 'scheduled'

  const { data: campaign, error } = await supabase
    .from('reactivation_campaigns')
    .insert({
      practice_id: practiceId,
      campaign_name: campaignName,
      angle_type: angleType,
      message_1_sms: messages.message_1_sms || null,
      message_1_email_subject: messages.message_1_email_subject || null,
      message_1_email_body: messages.message_1_email_body || null,
      message_2_sms: messages.message_2_sms || null,
      message_2_email_subject: messages.message_2_email_subject || null,
      message_2_email_body: messages.message_2_email_body || null,
      message_3_sms: messages.message_3_sms || null,
      filter_date_min,
      filter_date_max,
      total_recipients: recipients.length,
      messages_per_day: messagesPerDay,
      send_window_start: sendWindowStart,
      send_window_end: sendWindowEnd,
      send_days: sendDays,
      status,
      scheduled_start: start === 'now' ? nowIso : scheduledStart,
      started_at: start === 'now' ? nowIso : null,
    })
    .select()
    .single()
  if (error) throw error

  const rows = recipients.map((r) => ({
    campaign_id: campaign.id,
    practice_id: practiceId,
    consult_id: r.consult_id,
    patient_first: r.patient_first,
    patient_last: r.patient_last,
    patient_phone: r.patient_phone,
    patient_email: r.patient_email,
    status: 'pending',
  }))
  if (rows.length) {
    const { error: enrErr } = await supabase.from('reactivation_enrollments').insert(rows)
    if (enrErr) throw enrErr
  }
  return campaign
}

// Campaigns + per-campaign send/reply progress for the management list.
export async function fetchCampaigns(practiceId) {
  if (!practiceId) return []
  const { data: campaigns } = await supabase
    .from('reactivation_campaigns')
    .select('*')
    .eq('practice_id', practiceId)
    .order('created_at', { ascending: false })
  if (!campaigns?.length) return []

  const ids = campaigns.map((c) => c.id)
  const { data: enr } = await supabase
    .from('reactivation_enrollments')
    .select('campaign_id, status, messages_sent')
    .in('campaign_id', ids)

  const byCampaign = {}
  ;(enr || []).forEach((e) => {
    const b = (byCampaign[e.campaign_id] ||= { recipients: 0, sent: 0, replies: 0 })
    b.recipients++
    b.sent += e.messages_sent || 0
    if (e.status === 'replied') b.replies++
  })

  return campaigns.map((c) => {
    const steps = campaignSteps(c).length || 1
    const agg = byCampaign[c.id] || { recipients: c.total_recipients || 0, sent: 0, replies: 0 }
    const totalMsgs = (agg.recipients || c.total_recipients || 0) * steps
    return { ...c, _steps: steps, _recipients: agg.recipients, _sent: agg.sent, _totalMsgs: totalMsgs, _replies: agg.replies }
  })
}

export async function fetchEnrollments(campaignId) {
  const { data } = await supabase
    .from('reactivation_enrollments')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
  return data || []
}

export async function setCampaignStatus(campaignId, status) {
  const { error } = await supabase.from('reactivation_campaigns').update({ status }).eq('id', campaignId)
  if (error) throw error
}

// Conversions attributed to a campaign: enrolled patients whose consult later
// closed won. Used for the "X conversions from <campaign>, $Y" reporting line.
export async function fetchCampaignConversions(campaignId) {
  const { data: enr } = await supabase
    .from('reactivation_enrollments')
    .select('consult_id')
    .eq('campaign_id', campaignId)
  const consultIds = (enr || []).map((e) => e.consult_id).filter(Boolean)
  if (!consultIds.length) return { count: 0, value: 0 }
  const { data: won } = await supabase
    .from('consults')
    .select('id, case_value, status')
    .in('id', consultIds)
    .eq('status', 'closed_won')
  const count = (won || []).length
  const value = (won || []).reduce((s, c) => s + (c.case_value || 0), 0)
  return { count, value }
}

export const STATUS_BADGE = {
  draft: { label: 'Draft', classes: 'bg-slate-500/15 text-slate-300 ring-slate-400/20' },
  scheduled: { label: 'Scheduled', classes: 'bg-sky-500/15 text-sky-300 ring-sky-400/20' },
  active: { label: 'Active', classes: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20' },
  paused: { label: 'Paused', classes: 'bg-amber-500/15 text-amber-300 ring-amber-400/20' },
  completed: { label: 'Completed', classes: 'bg-slate-500/15 text-slate-400 ring-slate-400/20' },
}

export const ENROLLMENT_BADGE = {
  pending: { label: 'Pending', classes: 'bg-slate-500/15 text-slate-300' },
  sending: { label: 'In progress', classes: 'bg-sky-500/15 text-sky-300' },
  completed: { label: 'Completed', classes: 'bg-slate-500/15 text-slate-400' },
  replied: { label: 'Replied', classes: 'bg-emerald-500/15 text-emerald-300' },
  opted_out: { label: 'Opted out', classes: 'bg-rose-500/15 text-rose-300' },
}
