import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// analyze-consult - SLOW step. Given a consult_id whose de-identified transcript
// is already saved (by transcribe-consult, status "transcribed"), runs Claude
// analysis + drafts 6 follow-up messages, then flips status to "analyzed".
// Idempotent: re-triggering an already-analyzed consult is a no-op, and messages
// are only inserted when none exist yet.
//
// Auth: user JWT (resolves practice) or service-role bearer + practice_id.
// Secret: ANTHROPIC_API_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { resolveAuth } from "../_shared/auth.ts";
import { sanitizeAIOutput } from "../_shared/sanitize.ts";
import {
  buildMessageRowsFromAnalysis,
  computeScheduledFor,
  resolveTouchpoints,
  rulesFrom,
} from "../_shared/sequence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ---- Claude analysis --------------------------------------------------------
const analysisSystemPrompt = (treatmentType: string) => `You are CaseLift, an AI system that analyzes dental consultation recordings to help treatment coordinators recover unconverted patients.

Treatment type being analyzed: ${treatmentType}

Analyze the transcript and call the emit_analysis tool with your structured analysis. Never use em dashes (—) under any circumstances. Use commas, periods, or short sentences instead.

Adapt your analysis based on treatment type:

For dental_implants / full_arch:
- Primary objections: price, fear_surgery, spouse_approval, timing, health_concerns
- Key personal details: upcoming events, health conditions, financial situation
- Follow-up tone: clinical authority, financing focus, fear reduction

For invisalign:
- Primary objections: compliance_concerns, aesthetics, cost_vs_braces, timing, not_sure_needed
- Key personal details: social events, age of patient, profession
- Follow-up tone: lifestyle focused, confidence building, before/after results

For cosmetic_veneers:
- Primary objections: cost, fear_of_looking_fake, recovery_time, spouse_approval, timing
- Key personal details: upcoming events, career, confidence issues
- Follow-up tone: transformation focused, natural results, investment framing

For sleep_apnea:
- Primary objections: insurance_coverage, cpap_preference, cost, skepticism, spouse_referral
- Key personal details: sleep quality, energy levels, partner complaints
- Follow-up tone: health urgency, quality of life, insurance angle

For periodontal:
- Primary objections: cost, fear, insurance, denial_of_severity, timing
- Key personal details: health history, anxiety level
- Follow-up tone: health urgency, consequences of waiting, staged treatment options

For full_mouth_rehab / other:
- Primary objections: cost, overwhelm, timeline, fear, spouse_approval
- Key personal details: functional issues, confidence, life events
- Follow-up tone: phased approach, life-changing framing, financing

Populate exactly these fields (this is the emit_analysis tool's schema):
{
  "what_happened": "2-3 sentence narrative of what happened in the consult",
  "primary_objection": "one of the objection types listed above for this treatment",
  "primary_objection_detail": "specific detail from the conversation",
  "secondary_objection": "secondary objection or none",
  "secondary_objection_detail": "specific detail or empty string",
  "exit_intent": "hot|warm|long_term",
  "exit_intent_detail": "why you classified exit intent this way",
  "personal_detail": "one specific personal detail mentioned (event, family, job, health, etc)",
  "coaching_insight": "specific actionable coaching insight for the TC",
  "downsell_opportunity": "specific lower-cost alternative or none",
  "tc_action": "specific action TC should take in next 24 hours",
  "suggested_tx_value": "your estimate of treatment plan value based on what was discussed - number only, no $ sign, or null if unclear",
  "sms_1": "first SMS under 160 chars - warm personal, references their specific situation and treatment",
  "email_1_subject": "subject line",
  "email_1_body": "full email body - addresses primary objection with education specific to treatment type",
  "sms_2": "second SMS under 160 chars - gentle urgency around something real from their situation",
  "email_2_subject": "subject line",
  "email_2_body": "full email - patient story that mirrors their situation and treatment type",
  "sms_3": "third SMS under 160 chars - simple human check-in, no pressure",
  "email_3_subject": "subject line",
  "email_3_body": "final email - warm, honest, restate what is at stake for them specifically"
}`;

const STR = { type: "string" } as const;
const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    what_happened: STR,
    primary_objection: STR,
    primary_objection_detail: STR,
    secondary_objection: STR,
    secondary_objection_detail: STR,
    exit_intent: STR,
    exit_intent_detail: STR,
    personal_detail: STR,
    coaching_insight: STR,
    downsell_opportunity: STR,
    tc_action: STR,
    suggested_tx_value: { type: ["string", "number", "null"] },
    sms_1: STR,
    email_1_subject: STR,
    email_1_body: STR,
    sms_2: STR,
    email_2_subject: STR,
    email_2_body: STR,
    sms_3: STR,
    email_3_subject: STR,
    email_3_body: STR,
  },
  required: [
    "what_happened", "primary_objection", "primary_objection_detail", "secondary_objection",
    "secondary_objection_detail", "exit_intent", "exit_intent_detail", "personal_detail",
    "coaching_insight", "downsell_opportunity", "tc_action",
    "sms_1", "email_1_subject", "email_1_body", "sms_2", "email_2_subject", "email_2_body",
    "sms_3", "email_3_subject", "email_3_body",
  ],
};

// Force Claude to emit the analysis through this tool. With tool_choice pinned
// to it, the SDK hands us `input` already parsed as an object - so a stray prose
// preface, a markdown fence, or a truncated trailing brace can no longer break
// the response the way free-text JSON parsing did ("did not return parseable JSON").
const ANALYSIS_TOOL = {
  name: "emit_analysis",
  description: "Return the structured consult analysis and the six follow-up messages.",
  input_schema: ANALYSIS_SCHEMA,
};

async function analyze(anthropic: Anthropic, deidentified: string, treatmentType: string, note = "") {
  // On a regenerate the TC can steer the rewrite (e.g. "focus on financing").
  const guidance = note ? `\n\nAdditional guidance from the treatment coordinator for the follow-up messages: ${note}` : "";
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: analysisSystemPrompt(treatmentType),
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "emit_analysis" },
    messages: [{ role: "user", content: `Analyze this de-identified consult transcript:${guidance}\n\n${deidentified}` }],
  });
  // A cut-off response can leave the tool input partial - surface it clearly
  // rather than persisting half an analysis.
  if (response.stop_reason === "max_tokens") {
    throw new Error("Analysis was cut off before completing. Please try again.");
  }
  const tu = response.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use" || typeof tu.input !== "object" || tu.input === null) {
    throw new Error("Claude did not return a structured analysis.");
  }
  return tu.input as Record<string, unknown>;
}

// Map Claude's "none"/empty sentinels to null for clean DB storage, and strip
// em/en dashes from every AI string before it's persisted (covers what_happened,
// coaching_insight, tc_action, all sms_/email_ bodies + subjects).
const nn = (v: unknown) => {
  const s = typeof v === "string" ? sanitizeAIOutput(v).trim() : "";
  return s && s.toLowerCase() !== "none" ? s : null;
};

// Parse a suggested treatment value into a positive number, or null. Tolerates
// numbers, numeric strings, and strings with $ / commas (e.g. "$12,500").
const parsePositiveNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = await req.json().catch(() => ({}));
    const { ctx, error: authErr } = await resolveAuth(req, body);
    if (authErr || !ctx) return authErr ?? json({ error: "Unauthorized" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const auditClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // SLOW step: analyze an already-transcribed consult (saved by transcribe-consult).
    const consultId = body.consult_id;
    if (!consultId) return json({ error: "consult_id is required." }, 400);
    // Regenerate: re-run analysis on an already-analyzed consult, optionally with
    // a TC steering note, and replace the un-sent draft messages.
    const regenerate = body.regenerate === true;
    const note = typeof body.note === "string" ? body.note.trim() : "";

    const { data: consult, error: cErr } = await admin
      .from("consults")
      .select("id, practice_id, transcript_deidentified, status, created_at, treatment_type, tx_plan_value, tx_plan_value_source")
      .eq("id", consultId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!consult) return json({ error: "Consult not found." }, 404);
    // Access check: a user JWT can act on this consult only if RLS lets them see
    // it (practice member, agency owner of the practice, or super-admin). This is
    // impersonation-aware — unlike comparing against the caller's OWN practice,
    // which would wrongly 403 a super-admin/agency working in a sub-account.
    // Service-role calls (internal) are trusted. All writes below use the
    // consult's OWN practice id so the data never lands in the caller's practice.
    if (!ctx.isServiceRole) {
      const { data: allowed } = await ctx.client
        .from("consults").select("id").eq("id", consultId).maybeSingle();
      if (!allowed) return json({ error: "Not your practice's consult." }, 403);
    }
    const consultPracticeId = consult.practice_id;
    // Idempotent - the detail-page poller may trigger this more than once. A
    // regenerate request intentionally bypasses this to re-run the analysis.
    if (consult.status === "analyzed" && !regenerate) return json({ consult_id: consultId, status: "analyzed", already: true });

    const deidentified = consult.transcript_deidentified;
    if (!deidentified || !String(deidentified).trim()) {
      return json({ error: "This consult has no transcript to analyze yet." }, 422);
    }

    // Analyze + draft the 6-message sequence in one Claude call.
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "Analysis is unavailable - ANTHROPIC_API_KEY is not configured." }, 503);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const treatmentType = nn(consult.treatment_type) ?? "dental_implants";

    let a: Record<string, unknown>;
    try {
      a = await analyze(anthropic, deidentified, treatmentType, note);
    } catch (e) {
      const detail = (e as Error)?.message ?? String(e);
      console.error("Claude analysis failed:", detail);
      return json({ error: "AI analysis failed.", detail }, 502);
    }

    // Smart-timing preset is derived from exit intent (item #4); TC can override.
    const exitLevel = nn(a.exit_intent);
    const timingPreset = ["hot", "warm", "long_term"].includes(String(exitLevel)) ? exitLevel : null;

    const { data: practiceRow } = await admin
      .from("practices")
      .select("sequence_config, auto_start_followup, timezone")
      .eq("id", consultPracticeId)
      .maybeSingle();
    const autoStart = practiceRow?.auto_start_followup === true;
    const seqRules = rulesFrom(practiceRow?.sequence_config, practiceRow?.timezone);
    const touchpoints = resolveTouchpoints(practiceRow?.sequence_config, timingPreset);

    // Save analysis fields + flip status to "analyzed".
    const record: Record<string, unknown> = {
      status: "analyzed",
      what_happened: nn(a.what_happened),
      objection_type: nn(a.primary_objection),
      primary_objection: nn(a.primary_objection_detail),
      secondary_objection: nn(a.secondary_objection_detail) ?? nn(a.secondary_objection),
      exit_intent_level: exitLevel,
      exit_intent: nn(a.exit_intent_detail),
      sequence_timing_preset: timingPreset,
      followup_approved_at: autoStart ? new Date().toISOString() : null,
      personal_detail: nn(a.personal_detail),
      coaching_insight: nn(a.coaching_insight),
      downsell_opportunity: nn(a.downsell_opportunity),
      tc_action: nn(a.tc_action),
    };

    // Treatment-value estimate: only fill it in when the consult lacks an
    // authoritative value. Never overwrite a manual or PMS-sourced value.
    const existingValue = parsePositiveNumber(consult.tx_plan_value);
    const existingSource = nn(consult.tx_plan_value_source);
    const canEstimate = !existingValue || existingSource === "estimate" || existingSource === "practice_default";
    const suggestedValue = parsePositiveNumber(a.suggested_tx_value);
    if (canEstimate && suggestedValue !== null) {
      record.tx_plan_value = suggestedValue;
      record.tx_plan_value_source = "estimate";
    }

    const savedId = consultId;
    {
      const { error } = await admin.from("consults").update(record).eq("id", savedId);
      if (error) {
        console.error("Consult analysis update failed:", error.message);
        return json({ error: "Could not save the analysis.", detail: error.message }, 500);
      }
    }

    // On regenerate, clear the un-sent drafts so a fresh set is written below.
    // Already-sent messages (sent/opened/replied) are preserved.
    if (regenerate) {
      await admin.from("messages").delete().eq("consult_id", savedId).eq("status", "draft");
    }

    // Build + save the 6 follow-up messages - only if none exist yet (idempotent
    // against the detail-page poller triggering analysis more than once).
    let messagesOut: unknown[] = [];
    const { count: existingMsgs } = await admin
      .from("messages").select("id", { count: "exact", head: true }).eq("consult_id", savedId);
    if (!existingMsgs) {
      const contentRows = buildMessageRowsFromAnalysis(touchpoints, a, nn);
      if (contentRows.length) {
        const createdAt = consult.created_at || new Date().toISOString();
        const rows = contentRows.map((m, i) => {
          const tp = touchpoints[i];
          const day = tp?.day ?? 0;
          const scheduled_for = autoStart ? computeScheduledFor(createdAt, day, seqRules) : null;
          return {
            consult_id: savedId,
            practice_id: consultPracticeId,
            type: m.type,
            channel: m.channel,
            subject: m.subject,
            body: m.body,
            status: autoStart ? "scheduled" : "draft",
            send_day: day,
            scheduled_for,
          };
        });
        const { error } = await admin.from("messages").insert(rows);
        if (error) console.error("Message insert failed (analysis still saved):", error.message);
        else messagesOut = rows;
      }
    }

    // Best-effort notification (realtime bell) + audit log (non-blocking).
    try {
      const obj = nn(a.primary_objection);
      const exit = nn(a.exit_intent);
      await admin.from("notifications").insert({
        practice_id: consultPracticeId,
        type: "consult_analyzed",
        event: "consult_analyzed",
        title: "New consult ready for review",
        message: [obj ? `${obj} objection` : null, exit ? `${exit} intent` : null].filter(Boolean).join(" · ") || undefined,
        link: `/consults/${savedId}`,
      });
    } catch { /* non-blocking */ }
    try {
      await auditClient.rpc("log_audit_event", { p_action: "consult.analyzed", p_resource_type: "consult", p_resource_id: savedId, p_ip_address: ip });
    } catch { /* non-blocking */ }

    return json({ consult_id: savedId, analysis: a, messages: messagesOut });
  } catch (e) {
    await reportEdgeError("analyze-consult", e);
    console.error("analyze-consult error:", e);
    return json({ error: "Unexpected error while processing the consult.", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
