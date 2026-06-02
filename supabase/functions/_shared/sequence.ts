/**
 * Shared follow-up sequence scheduling (edge functions + mirrored in src/lib/sequence.js).
 */

export type Touchpoint = { day: number; channel: "sms" | "email"; enabled?: boolean };
export type SequenceRules = {
  holdHours: number;
  quietHours: boolean;
  quietStart: string;
  quietEnd: string;
  weekendDelivery: boolean;
  timezone?: string;
};

export const DEFAULT_TOUCHPOINTS: Touchpoint[] = [
  { day: 0, channel: "sms", enabled: true },
  { day: 3, channel: "sms", enabled: true },
  { day: 7, channel: "email", enabled: true },
  { day: 14, channel: "sms", enabled: true },
  { day: 30, channel: "email", enabled: true },
  { day: 60, channel: "sms", enabled: true },
  { day: 90, channel: "email", enabled: true },
  { day: 150, channel: "sms", enabled: true },
  { day: 180, channel: "email", enabled: true },
  { day: 240, channel: "sms", enabled: true },
  { day: 300, channel: "email", enabled: true },
  { day: 365, channel: "sms", enabled: true },
];

export const DEFAULT_RULES: SequenceRules = {
  holdHours: 24,
  quietHours: true,
  quietStart: "08:00",
  quietEnd: "18:00",
  weekendDelivery: true,
  timezone: "America/Chicago",
};

/** Smart-timing presets — days/channels used when consult.sequence_timing_preset is set. */
export const TIMING_PRESETS: Record<string, { label: string; days: number[]; channels: string[] }> = {
  hot: { label: "Hot", days: [0, 1, 3, 5, 7, 14], channels: ["sms", "email", "sms", "sms", "email", "sms"] },
  warm: { label: "Warm", days: [0, 3, 7, 14, 30, 60], channels: ["sms", "email", "sms", "email", "sms", "email"] },
  long_term: { label: "Long-term", days: [0, 7, 14, 30, 60, 90], channels: ["sms", "email", "sms", "email", "sms", "email"] },
};

// deno-lint-ignore no-explicit-any
export function parseCfg(cfg: any): { touchpoints?: Touchpoint[]; rules?: Partial<SequenceRules> } {
  try {
    const obj = typeof cfg === "string" ? JSON.parse(cfg) : (cfg || {});
    return obj?.touchpoints || obj?.rules ? obj : {};
  } catch {
    return {};
  }
}

export function rulesFrom(cfg: unknown, practiceTimezone?: string | null): SequenceRules {
  const r = parseCfg(cfg).rules || {};
  return {
    ...DEFAULT_RULES,
    ...r,
    timezone: (r.timezone as string) || practiceTimezone || DEFAULT_RULES.timezone,
  };
}

/** Enabled touchpoints from practice config, optionally merged with smart-timing preset. */
export function resolveTouchpoints(sequenceConfig: unknown, timingPreset?: string | null): Touchpoint[] {
  const parsed = parseCfg(sequenceConfig);
  const configTps = (Array.isArray(parsed.touchpoints) && parsed.touchpoints.length
    ? parsed.touchpoints
    : DEFAULT_TOUCHPOINTS
  )
    .filter((t) => t.enabled !== false)
    .map((t) => ({
      day: Math.max(0, Number(t.day) || 0),
      channel: t.channel === "email" ? "email" as const : "sms" as const,
      enabled: true,
    }));

  const presetKey = timingPreset && TIMING_PRESETS[timingPreset] ? timingPreset : null;
  if (!presetKey) return configTps.slice(0, 12);

  const preset = TIMING_PRESETS[presetKey];
  const out: Touchpoint[] = [];
  for (let i = 0; i < preset.days.length && i < 12; i++) {
    const day = preset.days[i];
    const rawCh = preset.channels[i] ?? "sms";
    const channel = rawCh === "email" ? "email" as const : "sms" as const;
    out.push({ day, channel, enabled: true });
  }
  return out;
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const zoned = new Date(at.toLocaleString("en-US", { timeZone }));
  return zoned.getTime() - utc.getTime();
}

function localParts(at: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function localToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const offset = tzOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offset);
}

/** When a day-offset message should send (practice timezone, hold, quiet hours, weekends). */
export function computeScheduledFor(createdAtIso: string, day: number, rules: SequenceRules): string {
  const tz = rules.timezone || DEFAULT_RULES.timezone;
  const created = new Date(createdAtIso).getTime();
  const holdMs = (rules.holdHours || 24) * 3600 * 1000;
  let at = new Date(Math.max(created + day * 86400000, created + holdMs));

  const [qs, qsm] = String(rules.quietStart || "08:00").split(":").map(Number);
  const [qe, qem] = String(rules.quietEnd || "18:00").split(":").map(Number);

  const applyQuiet = () => {
    if (rules.quietHours === false) return;
    let lp = localParts(at, tz);
    if (lp.hour < qs || (lp.hour === qs && lp.minute < (qsm || 0))) {
      at = localToUtc(lp.year, lp.month, lp.day, qs, qsm || 0, tz);
    } else if (lp.hour > qe || (lp.hour === qe && lp.minute >= (qem || 0))) {
      at = new Date(at.getTime() + 86400000);
      lp = localParts(at, tz);
      at = localToUtc(lp.year, lp.month, lp.day, qs, qsm || 0, tz);
    }
  };

  const applyWeekend = () => {
    if (rules.weekendDelivery !== false) return;
    let lp = localParts(at, tz);
    const dow = new Date(localToUtc(lp.year, lp.month, lp.day, 12, 0, tz).getTime()).getUTCDay();
    if (dow === 6) at = new Date(at.getTime() + 2 * 86400000);
    else if (dow === 0) at = new Date(at.getTime() + 86400000);
    lp = localParts(at, tz);
    at = localToUtc(lp.year, lp.month, lp.day, qs, qsm || 0, tz);
  };

  applyQuiet();
  applyWeekend();
  applyQuiet();
  return at.toISOString();
}

export type AnalysisPools = {
  sms: string[];
  emails: { subject: string | null; body: string | null }[];
};

/** Map Claude analysis output onto resolved touchpoints (up to 12). */
export function buildMessageRowsFromAnalysis(
  touchpoints: Touchpoint[],
  a: Record<string, unknown>,
  nn: (v: unknown) => string | null,
): { channel: string; type: string; subject: string | null; body: string | null }[] {
  const pools: AnalysisPools = {
    sms: [nn(a.sms_1), nn(a.sms_2), nn(a.sms_3)].filter(Boolean) as string[],
    emails: [
      { subject: nn(a.email_1_subject), body: nn(a.email_1_body) },
      { subject: nn(a.email_2_subject), body: nn(a.email_2_body) },
      { subject: nn(a.email_3_subject), body: nn(a.email_3_body) },
    ].filter((e) => e.body),
  };
  let si = 0;
  let ei = 0;
  const rows: { channel: string; type: string; subject: string | null; body: string | null }[] = [];
  for (let i = 0; i < touchpoints.length; i++) {
    const tp = touchpoints[i];
    if (tp.channel === "email") {
      const e = pools.emails[ei % pools.emails.length];
      if (!e?.body) continue;
      ei++;
      rows.push({
        channel: "email",
        type: i === 0 ? "followup" : "nurture",
        subject: e.subject,
        body: e.body,
      });
    } else {
      const body = pools.sms[si % pools.sms.length];
      if (!body) continue;
      si++;
      rows.push({
        channel: "sms",
        type: i === 0 ? "followup" : "nurture",
        subject: null,
        body,
      });
    }
  }
  return rows;
}

export function holdHoursFor(cfg: unknown): number {
  const h = rulesFrom(cfg).holdHours;
  return typeof h === "number" && h >= 1 && h <= 72 ? h : 24;
}
