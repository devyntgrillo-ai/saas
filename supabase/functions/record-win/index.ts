// ============================================================================
// record-win — records an "assisted win" and posts a Slack alert when a consult
// is closed AND CaseLift actually sent follow-up for it.
//
// A win counts only if >= 1 sequence message (messages.status='sent') exists for
// the consult — patients who closed without any CaseLift follow-up are skipped.
// Deduped per consult_id (unique index). Invoked by the PMS webhook
// (source: 'pms_webhook') and the in-app "Mark as Won" button (source: 'manual').
//
// Slack posts to SLACK_WINS_WEBHOOK_URL if set, else falls back to
// SLACK_WEBHOOK_URL (the signups channel).
// ============================================================================
import { reportEdgeError } from "../_shared/report-error.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
// "dental_implants" -> "Dental Implants"
const prettyTreatment = (t?: string | null) =>
  (t || "treatment").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
// "Robert", "Maxwell" -> "Robert M." (last-initial only, for privacy)
function privacyName(first?: string | null, last?: string | null, fallback?: string | null) {
  const f = (first || "").trim();
  const l = (last || "").trim();
  if (f) return l ? `${f} ${l[0].toUpperCase()}.` : f;
  return (fallback || "A patient").trim();
}

async function postSlack(text: string) {
  const url = Deno.env.get("SLACK_WINS_WEBHOOK_URL") || Deno.env.get("SLACK_WEBHOOK_URL");
  if (!url) return { sent: false };
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const consultId: string | undefined = body.consult_id;
    const source: string = body.source === "manual" ? "manual" : "pms_webhook";
    if (!consultId) return json({ error: "consult_id is required" }, 400);

    // --- Load the consult (source of truth for patient + value). ---
    const { data: consult, error: cErr } = await admin
      .from("consults")
      .select("id, practice_id, patient_first, patient_last, patient_name, treatment_type, case_value, tx_plan_value, pms_appointment_id")
      .eq("id", consultId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!consult) return json({ error: "Consult not found" }, 404);

    // --- Already recorded? (dedupe before counting/posting). ---
    const { data: existing } = await admin
      .from("assisted_wins").select("id").eq("consult_id", consultId).maybeSingle();
    if (existing) return json({ ok: true, recorded: false, reason: "already_recorded" });

    // --- Condition 2: at least one sequence message actually sent. ---
    const { data: sent, error: mErr } = await admin
      .from("messages")
      .select("sent_at")
      .eq("consult_id", consultId)
      .eq("status", "sent");
    if (mErr) throw mErr;
    const messagesSent = sent?.length ?? 0;
    if (messagesSent === 0) {
      // Patient closed with no CaseLift follow-up — not an assisted win.
      return json({ ok: true, recorded: false, reason: "no_sequence_messages" });
    }
    const firstSentAt = sent
      .map((m) => m.sent_at)
      .filter(Boolean)
      .sort()[0] ?? null;

    const practiceId = consult.practice_id ?? body.practice_id ?? null;
    const caseValue = Number(body.case_value ?? consult.tx_plan_value ?? consult.case_value ?? 0) || 0;
    const treatment = body.treatment_type || consult.treatment_type;
    const patientName = body.patient_name || privacyName(consult.patient_first, consult.patient_last, consult.patient_name);

    // --- Insert the win (unique consult_id guards races). ---
    const { error: insErr } = await admin.from("assisted_wins").insert({
      practice_id: practiceId,
      consult_id: consultId,
      patient_name: patientName,
      patient_id: consult.pms_appointment_id ?? consultId,
      treatment_type: treatment,
      case_value: caseValue,
      messages_sent: messagesSent,
      first_message_sent_at: firstSentAt,
      won_by: source,
    });
    if (insErr) {
      // Unique-violation = recorded by a concurrent call; treat as success.
      if ((insErr as { code?: string }).code === "23505") return json({ ok: true, recorded: false, reason: "already_recorded" });
      throw insErr;
    }

    // --- Slack alert. ---
    const { data: practice } = await admin
      .from("practices").select("name, company_name").eq("id", practiceId).maybeSingle();
    const practiceName = practice?.company_name || practice?.name || "Practice";
    const days = firstSentAt
      ? Math.max(1, Math.round((Date.now() - new Date(firstSentAt).getTime()) / 86_400_000))
      : null;
    const today = new Date().toISOString().slice(0, 10);
    const firstContact = firstSentAt ? new Date(firstSentAt).toISOString().slice(0, 10) : "unknown";

    const text = [
      `🏆 *CaseLift Win — ${practiceName}*`,
      "",
      `💰 *Case Value:* ${money(caseValue)}`,
      `🦷 *Treatment:* ${prettyTreatment(treatment)}`,
      `👤 *Patient:* ${patientName}`,
      `📨 *Messages Sent:* ${messagesSent} follow-up${messagesSent === 1 ? "" : "s"}${days ? ` over ${days} day${days === 1 ? "" : "s"}` : ""}`,
      `📅 *First Contact:* ${firstContact}`,
      `✅ *Closed:* ${today}`,
      "",
      "_CaseLift assisted in recovering this case._",
    ].join("\n");
    const slack = await postSlack(text);

    return json({ ok: true, recorded: true, messages_sent: messagesSent, case_value: caseValue, slack_sent: slack.sent });
  } catch (e) {
    await reportEdgeError("record-win", e);
    console.error("record-win error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
