import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// notify-slack - post a message to a Slack Incoming Webhook.
//
// Used for high-signal events (e.g. a treatment acceptance attributed to
// CaseLift). Callable with the service-role key from other edge functions, or
// directly with { text } | { blocks }. Degrades gracefully (200, sent:false)
// when SLACK_WEBHOOK_URL is not configured so callers never have to special-case it.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Reusable helper so other functions can `import { postSlack }`.
export async function postSlack(text: string): Promise<{ sent: boolean; reason?: string }> {
  const url = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!url) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { sent: false, reason: `slack_${res.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: String((e as Error)?.message ?? e) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text : "";
    if (!text) return json({ error: "Missing text" }, 400);
    const result = await postSlack(text);
    return json(result, result.sent || result.reason === "not_configured" ? 200 : 502);
  } catch (e) {
    await reportEdgeError("notify-slack", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
