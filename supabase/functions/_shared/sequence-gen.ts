/**
 * Shared "brain" helpers for generating + sanitizing follow-up sequence copy.
 *
 * Used by analyze-consult (initial generation) AND extend-sequences (year-long
 * continuation) so the prompt rules, banned-phrase handling, anti-hallucination
 * grounding, CTA guidance, and message-row mapping stay identical across both.
 */
import { sanitizeAIOutput } from "./sanitize.ts";
import { applyTcSignoff } from "./tc-signoff.ts";
import { computeScheduledFor, type SequenceRules } from "./sequence.ts";

// ── Banned AI-cliché / marketing phrasing (Part 4). ────────────────────────
export const BANNED = [
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

export function hasBanned(s: string | null): boolean {
  if (!s) return false;
  const l = s.toLowerCase();
  return BANNED.some((p) => l.includes(p));
}

/** Last-resort cleanup when banned phrasing survives regeneration retries. */
export function scrubBanned(s: string | null): string | null {
  if (!s) return s;
  let out = s;
  for (const p of BANNED) {
    out = out.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

/** Does any generated message use a banned phrase? Drives the regeneration retry. */
// deno-lint-ignore no-explicit-any
export function messagesHaveBanned(messages: any[]): boolean {
  for (const m of messages || []) {
    if (hasBanned(m?.body) || hasBanned(m?.subject)) return true;
  }
  return false;
}

// ── Anti-hallucination grounding (Part 5). ─────────────────────────────────
// The model may only reference a financing plan / guarantee / before-after
// gallery if the practice actually has one on file (in the KB) or the patient
// raised it in the transcript. Everything else is treated as fabricated and
// stripped post-generation as a safety net behind the prompt rule.
export type KbAllows = { financing: boolean; guarantee: boolean; beforeAfter: boolean };

export function kbAllowsFrom(
  kbText: string | null | undefined,
  opts?: { financingDiscussed?: boolean | null; transcript?: string | null },
): KbAllows {
  const t = `${kbText || ""}\n${opts?.transcript || ""}`.toLowerCase();
  return {
    financing:
      /financ|payment plan|monthly payment|0%|interest[- ]free|carecredit|care credit|cherry|sunbit|in[- ]house plan|pay over time/.test(t) ||
      opts?.financingDiscussed === true,
    guarantee: /guarantee|warrant|money[- ]back|lifetime (?:warranty|guarantee)/.test(t),
    beforeAfter: /before.{0,6}after|before\/after|smile gallery|case photos?|photo gallery/.test(t),
  };
}

const TOPIC_PATTERNS: { key: keyof KbAllows; re: RegExp }[] = [
  { key: "financing", re: /\b(financ\w*|payment plans?|monthly payments?|0%|interest[- ]free|carecredit|care\s?credit|spread (?:the|your) (?:cost|payments?)|pay over time)\b/i },
  { key: "guarantee", re: /\b(guarantee\w*|warrant\w*|money[- ]back|lifetime (?:warranty|guarantee))\b/i },
  { key: "beforeAfter", re: /\b(before[- ]and[- ]after|before\/after|case photos?|smile gallery|photo gallery)\b/i },
];

/**
 * Remove any sentence that makes a claim about a topic the practice has no
 * grounding for. Returns the cleaned text plus the sentences that were dropped
 * (for logging). If everything is dropped the result is an empty string, in
 * which case the caller should discard the message.
 */
export function scrubUngrounded(text: string | null, allow: KbAllows): { text: string | null; removed: string[] } {
  if (!text) return { text, removed: [] };
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const s of sentences) {
    let drop = false;
    for (const { key, re } of TOPIC_PATTERNS) {
      if (!allow[key] && re.test(s)) { drop = true; break; }
    }
    if (drop) removed.push(s.trim());
    else kept.push(s);
  }
  return { text: kept.join(" ").replace(/\s{2,}/g, " ").trim() || null, removed };
}

/** Prompt block describing exactly what the practice may and may not claim. */
export function groundingRules(allow: KbAllows): string {
  const has: string[] = [];
  if (allow.financing) has.push("financing / payment plans");
  if (allow.guarantee) has.push("a guarantee / warranty");
  if (allow.beforeAfter) has.push("before/after photos");
  const missing: string[] = [];
  if (!allow.financing) missing.push("financing or payment plans");
  if (!allow.guarantee) missing.push("guarantees or warranties");
  if (!allow.beforeAfter) missing.push("before/after photos");
  return `GROUNDING (critical, never violate):
- You may ONLY reference a specific offer, financing/payment plan, guarantee/warranty, before/after photos, exact pricing, discount, or office policy if it appears in the knowledge base or transcript above. NEVER invent or imply one.
- ${has.length ? `On file for this practice (OK to reference where relevant): ${has.join(", ")}.` : "Nothing extra is on file."}
- ${missing.length ? `NOT on file, so DO NOT mention: ${missing.join(", ")}.` : ""}
- If you are not certain a detail is true for this practice, leave it out. Keep the message about the patient and a simple next step instead.`;
}

/** Prompt block describing the single, concrete call-to-action each message needs. */
export function ctaRules(bookingUrl: string | null): string {
  return `CALL TO ACTION:
- Every sms/email ends with ONE specific, low-friction next step that makes saying yes easy. Never a vague "let me know" or "reach out anytime".
- Good CTAs: offer to hold a specific time ("I've got Tuesday at 2 or Thursday morning, want me to grab one?"), offer to answer one concrete question, or ask for a quick 5-minute call.
${bookingUrl
  ? `- A booking link is on file: ${bookingUrl}\n  Use it as the CTA when inviting them to schedule (e.g. "you can grab a time here: ${bookingUrl}"). Paste it plainly, never as a markdown link or placeholder.`
  : `- No booking link is on file, so invite them to reply with a good time or offer to call. NEVER paste a placeholder link or a made-up URL.`}`;
}

const nn = (v: unknown): string | null => {
  const s = typeof v === "string" ? sanitizeAIOutput(v).trim() : "";
  return s && s.toLowerCase() !== "none" ? s : null;
};
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(nn).filter(Boolean) as string[] : []);

export type BuiltRow = {
  consult_id: string;
  practice_id: string;
  type: string;
  channel: string;
  subject: string | null;
  body: string | null;
  call_script: string[] | null;
  purpose: string | null;
  tone: string | null;
  sequence_position: number;
  status: string;
  send_day: number;
  scheduled_for: string | null;
};

/**
 * Map a generated `messages[]` array (with channel + offset_hours) into DB rows,
 * applying TC sign-off, banned-phrase scrub, and grounding scrub. Drops any
 * message left empty after scrubbing. Shared by initial + continuation paths.
 */
export function buildSequenceRows(
  // deno-lint-ignore no-explicit-any
  gen: any[],
  opts: {
    consultId: string;
    practiceId: string;
    tcFirst: string;
    practiceName: string;
    createdAt: string;
    rules: SequenceRules;
    autoStart: boolean;
    allow: KbAllows;
    startPosition?: number;
  },
): { rows: BuiltRow[]; removedClaims: string[] } {
  const start = opts.startPosition ?? 0;
  const removedClaims: string[] = [];
  const clean = (s: unknown): string | null => {
    let out = applyTcSignoff(scrubBanned(nn(s)), opts.tcFirst, opts.practiceName);
    if (out) {
      const r = scrubUngrounded(out, opts.allow);
      out = r.text;
      if (r.removed.length) removedClaims.push(...r.removed);
    }
    return out;
  };

  const rows = (Array.isArray(gen) ? gen : [])
    .map((mRaw, i): BuiltRow => {
      const m = (mRaw || {}) as Record<string, unknown>;
      const channel = ["sms", "email", "call"].includes(String(m.channel)) ? String(m.channel) : "sms";
      const offsetHours = Math.max(0, Number(m.offset_hours) || 0);
      const day = offsetHours / 24;
      const bullets = arr(m.call_script_bullets);
      return {
        consult_id: opts.consultId,
        practice_id: opts.practiceId,
        type: start === 0 && i === 0 ? "followup" : "nurture",
        channel,
        subject: channel === "email" ? clean(m.subject) : null,
        body: channel === "call" ? null : clean(m.body),
        call_script: channel === "call" && bullets.length ? bullets : null,
        purpose: nn(m.purpose),
        tone: nn(m.tone),
        sequence_position: start + i + 1,
        status: opts.autoStart ? "scheduled" : "draft",
        send_day: Math.round(day),
        scheduled_for: opts.autoStart ? computeScheduledFor(opts.createdAt, day, opts.rules) : null,
      };
    })
    .filter((r) => (r.channel === "call" ? !!r.call_script : !!r.body));

  return { rows, removedClaims };
}
