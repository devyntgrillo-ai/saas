import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// analyze-consult - SLOW step. Given a consult_id whose de-identified transcript
// is saved (by transcribe-consult), runs Claude to (1) extract deep consult
// intelligence, (2) classify urgency, and (3) generate a DYNAMIC, personalized
// follow-up sequence (variable length + cadence + channel mix per the rules
// below), then flips status to "analyzed".
//
// Keeps the proven message-row model + send crons intact: each generated message
// is a row in `messages` (channel sms|email|call). Legacy analysis columns are
// still populated so existing UI / pipeline keep working.
//
// Auth: user JWT (resolves practice) or service-role bearer + practice_id.
// Secret: ANTHROPIC_API_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { resolveAuth } from "../_shared/auth.ts";
import { callerRole, roleCanViewPHI } from "../_shared/roles.ts";
import { sanitizeAIOutput } from "../_shared/sanitize.ts";
import { computeScheduledFor, rulesFrom } from "../_shared/sequence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Phrases that instantly make copy feel like an AI/marketing bot (Part 4).
const BANNED = [
  "i hope this message finds you well",
  "as per our conversation",
  "don't hesitate to reach out",
  "do not hesitate to reach out",
  "i wanted to follow up",
  "just checking in",
  "excited to help you on your journey",
  "state-of-the-art facility",
  "state of the art facility",
  "revolutionary",
  "cutting-edge",
  "cutting edge",
];
function scrubBanned(s: string | null): string | null {
  if (!s) return s;
  let out = s;
  for (const p of BANNED) {
    out = out.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim()
}
function hasBanned(s: string | null): boolean {
  if (!s) return false
  const l = s.toLowerCase()
  return BANNED.some((p) => l.includes(p))
}

// Cadence + length rules per classification (given to Claude; Part 2 + Part 3).
const CADENCE_RULES = `SEQUENCE LENGTH + CADENCE by classification (you decide offset_hours for each message):
- HOT: 8-10 messages over ~30 days, FRONT-LOADED. Phase 1 (days 1-14) every 1-2 days, then taper to 1-2/week.
- WARM: 10-14 messages over ~60 days. Phase 1 (days 1-14) every 2-3 days, then 1-2/week tapering to weekly.
- NURTURE: 8-10 messages over ~90 days. Phase 1 every 3-5 days, then weekly, then every 2 weeks. The FIRST message gently acknowledges they're still weighing it.
- LONG_TERM: 6-8 messages over ~90 days. Phase 1 every 5-7 days, then monthly. The FIRST message EXPLICITLY acknowledges their stated timeline ("you mentioned a few months — no rush").
CHANNEL MIX across the sequence ~ 50% sms, 30% email, 20% call. Lead with sms. Use email for the substantive/educational touches. Use 1-2 call reminders at high-value moments.
Messages must get progressively LIGHTER and lower-pressure over time, never more aggressive.`;

const SYSTEM = `You are an expert dental treatment coordinator copywriter. You write follow-up messages that feel genuinely human, deeply empathetic, and personally written. You never write AI-sounding or salesy copy. Every message should feel like it was typed by a real person who genuinely remembers and cares about this specific patient.

You will be given a de-identified consult transcript. Do TWO things and return them via the emit_sequence tool:

1) Extract structured intelligence about the patient and consult.
2) Classify urgency, then generate a personalized follow-up sequence.

Identify the ACTUAL treatment from the transcript (don't trust the booking hint). Never use em dashes — use commas or short sentences.

${CADENCE_RULES}

MESSAGE RULES:
- sms: aim <=160 chars (320 max), conversational, first-name only, end with a soft question/invitation. Vary the opening — NEVER start two messages the same way, and never start with "Hi [Name]!".
- email: personal subject (e.g. "Checking in, Robert" / "The financing option we discussed" — never salesy). 150-300 words, ONE clear CTA, education woven in naturally, reference their specific objection, sign off from the TC by first name.
- call: a reminder for the TC to call. Provide 3-4 call_script_bullets referencing their emotional anchor, primary objection, and financing if relevant. No body needed.
- ALWAYS reference something specific to THIS patient (their name used naturally, their emotional anchor, a detail they shared, or their exact objection).
- NEVER use placeholders like [FIRSTNAME] — use the real name. Never mention AI, automation, or software.
- NEVER use these phrases: "I hope this message finds you well", "as per our conversation", "don't hesitate to reach out", "I wanted to follow up", "just checking in", "excited to help you on your journey", "state-of-the-art facility", "revolutionary", "cutting-edge".
- Weave in 1-2 of the practice USPs/financing options ONLY where naturally relevant to this patient's objection — not as a list or a pitch.`;

const STR = { type: "string" } as const;
const STRN = { type: ["string", "null"] } as const;
const STRARR = { type: "array", items: STR } as const;

const TOOL = {
  name: "emit_sequence",
  description: "Return the structured consult intelligence and a dynamic, personalized follow-up sequence.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      // Intelligence (Part 1)
      patient_first_name: STRN,
      treatment_type: STR,
      case_value: { type: ["number", "string", "null"] },
      primary_objection: STR,
      primary_objection_words: STRN, // exact words used if possible
      secondary_objections: STRARR,
      emotional_anchor: STRN, // the specific life moment
      urgency_signals: STRN,
      decision_readiness: { type: ["integer", "null"] }, // 1-10
      spouse_involved: { type: ["boolean", "null"] },
      decision_maker: STRN,
      financing_discussed: { type: ["boolean", "null"] },
      financing_detail: STRN,
      fears: STRARR,
      responded_positively_to: STRARR,
      created_hesitation: STRARR,
      lead_source: STRN, // referral | internet | unknown
      personal_details: STRARR,
      // Classification + legacy/coaching
      urgency_classification: { type: "string", enum: ["HOT", "WARM", "NURTURE", "LONG_TERM"] },
      what_happened: STR,
      coaching_insight: STR,
      downsell_opportunity: STRN,
      tc_action: STR,
      // Sequence (Parts 2,3,7)
      messages: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            channel: { type: "string", enum: ["sms", "email", "call"] },
            offset_hours: { type: "number" },
            subject: STRN,
            body: STRN,
            call_script_bullets: STRARR,
            purpose: STR,
            tone: STR,
          },
          required: ["channel", "offset_hours", "purpose", "tone"],
        },
      },
    },
    required: [
      "treatment_type", "primary_objection", "secondary_objections", "fears",
      "responded_positively_to", "created_hesitation", "personal_details",
      "urgency_classification", "what_happened", "coaching_insight", "tc_action", "messages",
    ],
  },
};

async function generate(anthropic: Anthropic, userPrompt: string) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "emit_sequence" },
    messages: [{ role: "user", content: userPrompt }],
  });
  if (response.stop_reason === "max_tokens") throw new Error("Generation was cut off. Please try again.");
  const tu = response.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use" || typeof tu.input !== "object" || tu.input === null) {
    throw new Error("Claude did not return a structured sequence.");
  }
  return tu.input as Record<string, unknown>;
}

const nn = (v: unknown) => {
  const s = typeof v === "string" ? sanitizeAIOutput(v).trim() : "";
  return s && s.toLowerCase() !== "none" ? s : null;
};
const arr = (v: unknown): string[] => Array.isArray(v) ? v.map((x) => nn(x)).filter(Boolean) as string[] : [];
const parsePositiveNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "string") { const n = Number(v.replace(/[$,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; }
  return null;
};
// Urgency → legacy exit-intent bucket so existing UI/timing keep working.
const URGENCY_TO_EXIT: Record<string, string> = { HOT: "hot", WARM: "warm", NURTURE: "long_term", LONG_TERM: "long_term" };

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

    const consultId = body.consult_id;
    if (!consultId) return json({ error: "consult_id is required." }, 400);
    const regenerate = body.regenerate === true;
    const note = typeof body.note === "string" ? body.note.trim() : "";

    const { data: consult } = await admin
      .from("consults")
      .select("id, practice_id, transcript_deidentified, status, created_at, treatment_type, tx_plan_value, tx_plan_value_source, patient_first")
      .eq("id", consultId).maybeSingle();
    if (!consult) return json({ error: "Consult not found." }, 404);
    if (!ctx.isServiceRole) {
      const { data: allowed } = await ctx.client.from("consults").select("id").eq("id", consultId).maybeSingle();
      if (!allowed) return json({ error: "Not your practice's consult." }, 403);
      // Minimum necessary: the response carries patient intelligence + drafted
      // messages (PHI). A read-only viewer must never receive it.
      const role = await callerRole(ctx);
      if (!roleCanViewPHI(role)) {
        await admin.from("audit_logs").insert({
          user_id: ctx.userId ?? null, user_role: role, practice_id: consult.practice_id,
          action: "access.denied", resource_type: "consult", resource_id: String(consultId),
          details: { reason: "insufficient_role", role, fn: "analyze-consult" }, phi_accessed: false,
        });
        return json({ error: "Your role does not have access to consult intelligence." }, 403);
      }
    }
    const practiceId = consult.practice_id;
    if (consult.status === "analyzed" && !regenerate) return json({ consult_id: consultId, status: "analyzed", already: true });

    const deidentified = consult.transcript_deidentified;
    if (!deidentified || !String(deidentified).trim()) return json({ error: "This consult has no transcript to analyze yet." }, 422);

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "Analysis is unavailable - ANTHROPIC_API_KEY is not configured." }, 503);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // ── Knowledge base (Part 5): structured table + legacy JSONB sections. ──
    const { data: kbRows } = await admin
      .from("practice_knowledge_base").select("category, content").eq("practice_id", practiceId).eq("is_active", true).limit(40);
    const { data: pr } = await admin
      .from("practices").select("sequence_config, auto_start_followup, timezone, knowledge_base_sections, name")
      .eq("id", practiceId).maybeSingle();
    const kbLines: string[] = [];
    for (const r of (kbRows || [])) kbLines.push(`[${r.category}] ${r.content}`);
    const sections = pr?.knowledge_base_sections;
    if (sections && typeof sections === "object") {
      for (const v of Object.values(sections)) {
        if (typeof v === "string" && v.trim()) kbLines.push(v.trim());
        else if (v && typeof v === "object" && typeof (v as any).content === "string") kbLines.push((v as any).content.trim());
      }
    }
    const kbBlock = kbLines.length ? kbLines.slice(0, 25).join("\n") : "(none on file)";

    // ── Learning hint (Part 6): top channel by reply rate for this practice. ──
    let channelHint = "Not enough data yet — use the standard mix.";
    try {
      const { data: outcomes } = await admin
        .from("message_outcomes").select("message_channel, replied").eq("practice_id", practiceId).limit(2000);
      if (outcomes && outcomes.length >= 20) {
        const agg: Record<string, { n: number; r: number }> = {};
        for (const o of outcomes) {
          const c = o.message_channel || "unknown";
          agg[c] = agg[c] || { n: 0, r: 0 };
          agg[c].n++; if (o.replied) agg[c].r++;
        }
        const ranked = Object.entries(agg).filter(([, s]) => s.n >= 10)
          .map(([c, s]) => ({ c, rate: s.r / s.n })).sort((a, b) => b.rate - a.rate);
        if (ranked.length) channelHint = ranked.map((x) => `${x.c} ${(x.rate * 100).toFixed(0)}% reply`).join(", ") + ". Weight the mix toward the higher-replying channel.";
      }
    } catch { /* non-blocking */ }

    const treatmentHint = nn(consult.treatment_type) ?? "unknown (identify from the transcript)";
    const firstName = nn(consult.patient_first) ?? "the patient";
    const userPrompt = `Generate the intelligence + a personalized follow-up sequence for this dental patient from the transcript below.

Patient first name (use this exact name): ${firstName}
Treatment hint (may be wrong, identify the real one): ${treatmentHint}
Practice: ${nn(pr?.name) ?? "this practice"}
Practice USPs / financing / protocols / guarantees / testimonials (weave 1-2 in naturally where relevant):
${kbBlock}
This practice's channel performance: ${channelHint}
${note ? `\nExtra guidance from the treatment coordinator: ${note}\n` : ""}
De-identified transcript:
${deidentified}`;

    // Generate with up to 3 attempts (Part 10). Scrub any banned phrase that slips through.
    let a: Record<string, unknown> | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try { a = await generate(anthropic, userPrompt); break; }
      catch (e) { lastErr = (e as Error)?.message ?? String(e); }
    }
    if (!a) {
      await admin.from("consults").update({ status: "needs_manual_sequence" }).eq("id", consultId).then(() => {}, () => {});
      return json({ error: "AI generation failed after retries.", detail: lastErr }, 502);
    }

    const urgency = String(a.urgency_classification || "WARM").toUpperCase();
    const exitLevel = URGENCY_TO_EXIT[urgency] || "warm";
    const autoStart = pr?.auto_start_followup === true;
    const seqRules = rulesFrom(pr?.sequence_config, pr?.timezone);

    // Full intelligence object (Part 1).
    const intelligence = {
      patient_first_name: nn(a.patient_first_name) ?? firstName,
      treatment_type: nn(a.treatment_type),
      case_value: parsePositiveNumber(a.case_value),
      primary_objection: nn(a.primary_objection),
      primary_objection_words: nn(a.primary_objection_words),
      secondary_objections: arr(a.secondary_objections),
      emotional_anchor: nn(a.emotional_anchor),
      urgency_signals: nn(a.urgency_signals),
      decision_readiness: typeof a.decision_readiness === "number" ? a.decision_readiness : null,
      spouse_involved: typeof a.spouse_involved === "boolean" ? a.spouse_involved : null,
      decision_maker: nn(a.decision_maker),
      financing_discussed: typeof a.financing_discussed === "boolean" ? a.financing_discussed : null,
      financing_detail: nn(a.financing_detail),
      fears: arr(a.fears),
      responded_positively_to: arr(a.responded_positively_to),
      created_hesitation: arr(a.created_hesitation),
      lead_source: nn(a.lead_source),
      personal_details: arr(a.personal_details),
      urgency_classification: urgency,
    };

    const record: Record<string, unknown> = {
      status: "analyzed",
      consult_intelligence: intelligence,
      urgency_classification: urgency,
      decision_readiness: intelligence.decision_readiness,
      consecutive_no_reply: 0,
      what_happened: nn(a.what_happened),
      objection_type: nn(a.primary_objection),
      primary_objection: nn(a.primary_objection_words) ?? nn(a.primary_objection),
      secondary_objection: intelligence.secondary_objections[0] ?? null,
      exit_intent_level: exitLevel,
      exit_intent: nn(a.urgency_signals),
      sequence_timing_preset: exitLevel,
      followup_approved_at: autoStart ? new Date().toISOString() : null,
      personal_detail: intelligence.personal_details[0] ?? nn(a.emotional_anchor),
      coaching_insight: nn(a.coaching_insight),
      downsell_opportunity: nn(a.downsell_opportunity),
      tc_action: nn(a.tc_action),
    };
    const detectedType = nn(a.treatment_type);
    if (detectedType && !nn(consult.treatment_type)) record.treatment_type = detectedType;
    const existingValue = parsePositiveNumber(consult.tx_plan_value);
    const existingSource = nn(consult.tx_plan_value_source);
    const canEstimate = !existingValue || existingSource === "estimate" || existingSource === "practice_default";
    if (canEstimate && intelligence.case_value !== null) {
      record.tx_plan_value = intelligence.case_value;
      record.tx_plan_value_source = "estimate";
    }

    const { error: upErr } = await admin.from("consults").update(record).eq("id", consultId);
    if (upErr) return json({ error: "Could not save the analysis.", detail: upErr.message }, 500);

    if (regenerate) await admin.from("messages").delete().eq("consult_id", consultId).eq("status", "draft");

    // Build message rows from the generated dynamic sequence.
    let messagesOut: unknown[] = [];
    const { count: existingMsgs } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("consult_id", consultId);
    if (!existingMsgs) {
      const createdAt = consult.created_at || new Date().toISOString();
      const gen = Array.isArray(a.messages) ? a.messages : [];
      const rows = gen.map((mRaw, i) => {
        const m = mRaw as Record<string, unknown>;
        const channel = ["sms", "email", "call"].includes(String(m.channel)) ? String(m.channel) : "sms";
        const offsetHours = Math.max(0, Number(m.offset_hours) || 0);
        const day = offsetHours / 24;
        const bullets = arr(m.call_script_bullets);
        return {
          consult_id: consultId,
          practice_id: practiceId,
          type: i === 0 ? "followup" : "nurture",
          channel,
          subject: channel === "email" ? scrubBanned(nn(m.subject)) : null,
          body: channel === "call" ? null : scrubBanned(nn(m.body)),
          call_script: channel === "call" && bullets.length ? bullets : null,
          purpose: nn(m.purpose),
          tone: nn(m.tone),
          sequence_position: i + 1,
          status: autoStart ? "scheduled" : "draft",
          send_day: Math.round(day),
          scheduled_for: autoStart ? computeScheduledFor(createdAt, day, seqRules) : null,
        };
      }).filter((r) => r.channel === "call" ? !!r.call_script : !!r.body);
      if (rows.length) {
        const { error } = await admin.from("messages").insert(rows);
        if (error) console.error("Message insert failed (analysis saved):", error.message);
        else messagesOut = rows;
      }
    }

    try {
      await admin.from("notifications").insert({
        practice_id: practiceId, type: "consult_analyzed", event: "consult_analyzed",
        title: "New consult ready for review",
        message: [nn(a.primary_objection) ? `${nn(a.primary_objection)} objection` : null, `${urgency} urgency`].filter(Boolean).join(" · ") || undefined,
        link: `/consults/${consultId}`,
      });
    } catch { /* non-blocking */ }
    try { await admin.rpc("log_audit_event", { p_action: "consult.analyzed", p_resource_type: "consult", p_resource_id: consultId, p_ip_address: ip }); } catch { /* non-blocking */ }

    return json({ consult_id: consultId, urgency, intelligence, message_count: messagesOut.length, messages: messagesOut });
  } catch (e) {
    await reportEdgeError("analyze-consult", e);
    console.error("analyze-consult error:", e);
    return json({ error: "Unexpected error while processing the consult.", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
