// Global client-side error reporter → posts to the #caselift-errors Slack
// channel via an incoming webhook.
//
// IMPORTANT (CORS): Slack's incoming-webhook endpoint rejects the CORS preflight
// that an `application/json` content-type triggers, so setting that header makes
// the request silently fail from the browser. We send it as a CORS-"simple"
// request (no custom Content-Type → text/plain) which skips the preflight; Slack
// still parses the JSON body. The webhook URL is a VITE_ var, so it ships in the
// bundle — fine for a dedicated error channel, but rotate it if it leaks.

const WEBHOOK = import.meta.env.VITE_SLACK_ERROR_WEBHOOK_URL
const RATE_MS = 60_000

// Module-level rate limiter: skip if the same error message fired < 60s ago, so
// a repeating error doesn't spam Slack.
let lastMessage = null
let lastTime = 0

export async function reportError(error, context = {}) {
  try {
    if (!WEBHOOK) return
    const message = error?.message || String(error)

    const now = Date.now()
    if (message === lastMessage && now - lastTime < RATE_MS) return
    lastMessage = message
    lastTime = now

    const payload = {
      text: [
        '🚨 *CaseLift Error*',
        `*Error:* ${message}`,
        `*Page:* ${window.location.pathname}`,
        `*User:* ${context.email || 'unknown'}`,
        `*Practice:* ${context.practiceId || 'unknown'}`,
        `*Time:* ${new Date().toISOString()}`,
        context.extra ? `*Details:* ${context.extra}` : null,
        error?.stack ? `*Stack:*\n\`\`\`${error.stack.slice(0, 500)}\`\`\`` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    }

    // No headers → CORS-simple request (avoids the preflight Slack rejects).
    await fetch(WEBHOOK, { method: 'POST', body: JSON.stringify(payload) })
  } catch {
    // Never throw from the error reporter.
  }
}
