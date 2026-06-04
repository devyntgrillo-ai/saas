import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// notify-signup - post a Slack message to the internal CaseLift channel when a
// practice activates a paid subscription.
//
// Called server-to-server by ls-webhook (and/or chargebee-webhook) with
// { practice_id } and a service-role bearer, on the first activation event.
// Resolves the practice and posts via the Slack incoming webhook. Best-effort:
// if the webhook isn't configured it logs and returns ok:false.
//
// The Slack webhook is a SERVER-SIDE secret (never a VITE_ var) so it can't be
// extracted from the public client bundle.
//
// Secrets: SUPABASE_SERVICE_ROLE_KEY, SLACK_WEBHOOK_URL.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const practiceId: string | undefined = body.practice_id;
    if (!practiceId) return json({ error: "Missing 'practice_id'" }, 400);

    const webhook = Deno.env.get("SLACK_WEBHOOK_URL");
    if (!webhook) {
      console.warn("notify-signup: SLACK_WEBHOOK_URL not set - skipping Slack post");
      return json({ ok: false, reason: "slack_not_configured" });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: p } = await admin
      .from("practices")
      .select("name, email, phone, doctor_first, doctor_last, pms_type, heard_from, plan_amount")
      .eq("id", practiceId)
      .maybeSingle();
    if (!p) return json({ error: "Practice not found" }, 404);

    const contact = [p.doctor_first, p.doctor_last].filter(Boolean).join(" ").trim() || "—";
    const amount = Number(p.plan_amount ?? 997).toLocaleString();
    const when = new Date().toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/New_York",
    });

    const text =
      `🎉 New CaseLift signup!\n` +
      `Practice: ${p.name || "—"}\n` +
      `Contact: ${contact} — ${p.email || "—"}\n` +
      `Phone: ${p.phone || "—"}\n` +
      `PMS: ${p.pms_type || "—"}\n` +
      `Heard from: ${p.heard_from || "—"}\n` +
      `Plan amount: $${amount}\n` +
      `Time: ${when}`;

    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(`notify-signup: Slack post failed ${res.status}:`, detail);
      return json({ ok: false, reason: `slack_${res.status}` });
    }

    return json({ ok: true });
  } catch (e) {
    await reportEdgeError("notify-signup", e);
    console.error("notify-signup error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
