// Renders composer text with formatting applied live (bold shows bold, etc.)
// while preserving EVERY character in place so it aligns char-for-char behind a
// transparent-text <textarea> (the caret stays correct). Markers are dimmed
// rather than removed so positions match the textarea exactly.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function applyRule(nodes, regex, render) {
  const out = []
  let key = 0
  for (const node of nodes) {
    if (typeof node !== 'string') { out.push(node); continue }
    let last = 0
    let m
    regex.lastIndex = 0
    while ((m = regex.exec(node))) {
      if (m.index > last) out.push(node.slice(last, m.index))
      out.push(render(m, key++))
      last = m.index + m[0].length
      if (m.index === regex.lastIndex) regex.lastIndex++
    }
    if (last < node.length) out.push(node.slice(last))
  }
  return out
}

const dim = 'text-slate-500/50'

export function renderEditorHighlight(text, mentionNames = []) {
  if (!text) return null
  let nodes = [text]
  nodes = applyRule(nodes, /`([^`]+)`/g, (m, k) => (
    <span key={`c${k}`}><span className={dim}>`</span><code className="rounded bg-surface-700/60">{m[1]}</code><span className={dim}>`</span></span>
  ))
  nodes = applyRule(nodes, /\*\*([^*]+)\*\*/g, (m, k) => (
    <span key={`b${k}`}><span className={dim}>**</span><strong>{m[1]}</strong><span className={dim}>**</span></span>
  ))
  nodes = applyRule(nodes, /~~([^~]+)~~/g, (m, k) => (
    <span key={`st${k}`}><span className={dim}>~~</span><s>{m[1]}</s><span className={dim}>~~</span></span>
  ))
  nodes = applyRule(nodes, /\*([^*\n]+)\*/g, (m, k) => (
    <span key={`i${k}`}><span className={dim}>*</span><em>{m[1]}</em><span className={dim}>*</span></span>
  ))
  const names = [...new Set(mentionNames.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (names.length) {
    const re = new RegExp(`@(${names.map(escapeRe).join('|')})`, 'g')
    nodes = applyRule(nodes, re, (m, k) => (
      <span key={`m${k}`} className="rounded bg-[color:var(--accent-subtle)] text-[color:var(--accent)]">@{m[1]}</span>
    ))
  }
  return nodes
}
