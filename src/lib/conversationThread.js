/** Normalize email subject for thread grouping (strip Re:/Fwd: prefixes). */
export function normalizeEmailSubject(subject) {
  let s = String(subject || '(no subject)').trim()
  while (/^(re|fwd|fw):\s*/i.test(s)) {
    s = s.replace(/^(re|fwd|fw):\s*/i, '').trim()
  }
  return s.toLowerCase() || '(no subject)'
}

/** Display subject for thread header (original casing, no Re:/Fwd:). */
export function displayEmailSubject(subject) {
  let s = String(subject || '').trim()
  while (/^(re|fwd|fw):\s*/i.test(s)) {
    s = s.replace(/^(re|fwd|fw):\s*/i, '').trim()
  }
  return s || '(No subject)'
}

/** True when the patient sent the first message in a thread (align left). */
export function threadStartedByPatient(messages) {
  return messages?.[0]?.direction === 'inbound'
}

/**
 * Build render list: email threads by subject, SMS threads by consecutive runs.
 * Each thread renders at the position of its latest message.
 */
export function buildThreadRenderList(messages) {
  if (!messages?.length) return []

  const consumed = new Set()
  /** @type {Map<number, { channel: 'email' | 'sms', messages: object[] }>} */
  const threadAtIndex = new Map()

  // --- Email: group by normalized subject ---
  const subjectBuckets = new Map()
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.channel !== 'email') continue
    const key = normalizeEmailSubject(m.meta?.subject || m.subject)
    if (!subjectBuckets.has(key)) subjectBuckets.set(key, [])
    subjectBuckets.get(key).push({ message: m, index: i })
  }

  for (const entries of subjectBuckets.values()) {
    if (!entries.length) continue
    const msgs = entries.map((e) => e.message)
    const lastIndex = entries[entries.length - 1].index
    threadAtIndex.set(lastIndex, { channel: 'email', messages: msgs })
    for (const e of entries) consumed.add(e.index)
  }

  // --- SMS: group consecutive runs (broken by other channel types) ---
  let smsRun = []
  const flushSmsRun = () => {
    if (!smsRun.length) return
    const msgs = smsRun.map((r) => r.message)
    const lastIndex = smsRun[smsRun.length - 1].index
    threadAtIndex.set(lastIndex, { channel: 'sms', messages: msgs })
    for (const r of smsRun) consumed.add(r.index)
    smsRun = []
  }

  for (let i = 0; i < messages.length; i++) {
    if (consumed.has(i)) {
      flushSmsRun()
      continue
    }
    const m = messages[i]
    if (m.channel === 'sms') {
      smsRun.push({ message: m, index: i })
    } else {
      flushSmsRun()
    }
  }
  flushSmsRun()

  const items = []
  for (let i = 0; i < messages.length; i++) {
    if (consumed.has(i)) {
      const thread = threadAtIndex.get(i)
      if (thread) {
        items.push({ type: 'thread', channel: thread.channel, messages: thread.messages, index: i })
      }
      continue
    }
    items.push({ type: 'message', message: messages[i], index: i })
  }
  return items
}

export function renderItemTimestamp(item) {
  const m = item.type === 'thread'
    ? item.messages[item.messages.length - 1]
    : item.message
  return m.sent_at || m.created_at
}
