// Shared edge-function error reporter → #caselift-errors Slack channel.
// Uses the server-side SLACK_ERROR_WEBHOOK_URL secret (no CORS concerns on the
// server). Never throws — safe to call from any catch block.
import { redactPhi } from "./phi.ts";

const SLACK_ERROR_WEBHOOK = Deno.env.get("SLACK_ERROR_WEBHOOK_URL");

// deno-lint-ignore no-explicit-any
export async function reportEdgeError(fnName: string, error: any, context: Record<string, unknown> = {}) {
  if (!SLACK_ERROR_WEBHOOK) return;
  try {
    await fetch(SLACK_ERROR_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: [
          "🚨 *CaseLift Edge Function Error*",
          `*Function:* ${fnName}`,
          // Scrub emails/phones in case a throw site interpolated patient contact info.
          `*Error:* ${redactPhi(error?.message || String(error))}`,
          `*Time:* ${new Date().toISOString()}`,
          context.practiceId ? `*Practice:* ${context.practiceId}` : null,
        ].filter(Boolean).join("\n"),
      }),
    });
  } catch {
    // never throw from the error reporter
  }
}
