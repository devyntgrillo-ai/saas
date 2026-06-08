// Lightweight, dependency-free message formatter: links, **bold**, *italic*,
// `code`, and @mention highlighting. Returns an array of React nodes.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Apply one regex rule to the string segments of `nodes`, leaving existing
// element nodes (already formatted) untouched.
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

export function firstUrl(text) {
  const m = (text || '').match(/https?:\/\/[^\s]+/)
  return m ? m[0].replace(/[.,)\]]+$/, '') : null
}

export function renderRich(text, mentionNames = []) {
  if (!text) return null
  let nodes = [text]
  nodes = applyRule(nodes, /`([^`]+)`/g, (m, k) => (
    <code key={`c${k}`} className="rounded bg-surface-700 px-1 py-0.5 text-[0.85em]">{m[1]}</code>
  ))
  nodes = applyRule(nodes, /\*\*([^*]+)\*\*/g, (m, k) => <strong key={`b${k}`}>{m[1]}</strong>)
  nodes = applyRule(nodes, /\*([^*\n]+)\*/g, (m, k) => <em key={`i${k}`}>{m[1]}</em>)
  nodes = applyRule(nodes, /(https?:\/\/[^\s]+)/g, (m, k) => (
    <a key={`l${k}`} href={m[1]} target="_blank" rel="noreferrer" className="text-primary-300 underline underline-offset-2 hover:text-primary-200">{m[1]}</a>
  ))
  const names = [...new Set(mentionNames.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (names.length) {
    const re = new RegExp(`@(${names.map(escapeRe).join('|')})`, 'g')
    nodes = applyRule(nodes, re, (m, k) => (
      <span key={`m${k}`} className="rounded bg-primary/20 px-1 font-medium text-primary-200">@{m[1]}</span>
    ))
  }
  return nodes
}
