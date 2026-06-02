// The practice "AI intelligence file" - structured sections that compile into
// the system context Claude uses when analyzing that practice's consults.
// Stored as JSON text in practices.knowledge_base.

export const EMPTY_KB = {
  overview: '',
  objectionsThatWork: [],
  whatDoesNotWork: [],
  patientStories: [], // { id, title, story }
  coachingNotes: '',
  pricingReference: '',
  schedulingNotes: '',
  updatedAt: null,
}

export function parseKB(text) {
  if (!text) return { ...EMPTY_KB }
  try {
    const obj = typeof text === 'string' ? JSON.parse(text) : text
    return { ...EMPTY_KB, ...obj }
  } catch {
    // Legacy / freeform content - keep it visible in the overview.
    return { ...EMPTY_KB, overview: String(text) }
  }
}

export function newStoryId() {
  return (crypto?.randomUUID?.() || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`)
}

// Assemble the editable sections into the markdown block Claude receives as context.
export function assembleContext(kb) {
  const parts = []
  if (kb.overview?.trim()) parts.push(`# Practice Overview\n${kb.overview.trim()}`)

  const objections = (kb.objectionsThatWork || []).filter((x) => x?.trim())
  if (objections.length) parts.push(`# Common Objections & What Works\n${objections.map((o) => `- ${o.trim()}`).join('\n')}`)

  const notWork = (kb.whatDoesNotWork || []).filter((x) => x?.trim())
  if (notWork.length) parts.push(`# What Does NOT Work\n${notWork.map((o) => `- ${o.trim()}`).join('\n')}`)

  const stories = (kb.patientStories || []).filter((s) => s?.title?.trim() || s?.story?.trim())
  if (stories.length) {
    parts.push(
      `# Patient Stories That Convert\n${stories
        .map((s) => `- ${s.title?.trim() ? `**${s.title.trim()}** - ` : ''}${s.story?.trim() || ''}`)
        .join('\n')}`
    )
  }

  if (kb.coachingNotes?.trim()) parts.push(`# TC Coaching Notes\n${kb.coachingNotes.trim()}`)
  if (kb.pricingReference?.trim()) parts.push(`# Pricing Reference Points\n${kb.pricingReference.trim()}`)
  if (kb.schedulingNotes?.trim()) parts.push(`# Scheduling & Availability Notes\n${kb.schedulingNotes.trim()}`)

  return parts.join('\n\n')
}

// Stable serialization for change-detection / persistence (excludes updatedAt).
export function serializeKB(kb) {
  const copy = { ...kb }
  delete copy.updatedAt
  return JSON.stringify(copy)
}
