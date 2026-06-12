import { DEFAULT_TREATMENT, TREATMENT_TYPES } from '@/lib/treatments';

const TREATMENT_BY_VALUE = Object.fromEntries(TREATMENT_TYPES.map((t) => [t.value, t]));

type ConsultRow = {
  id?: string;
  status?: string | null;
  outcome?: string | null;
  case_value?: number | null;
  tx_plan_value?: number | null;
  tx_plan_value_source?: string | null;
  treatment_type?: string | null;
  attribution_status?: string | null;
};

type PracticeLike =
  | { treatment_defaults?: Record<string, unknown> | null; [key: string]: unknown }
  | null
  | undefined;

/** Mirror of web src/lib/analytics.js formatMoney — keep output identical. */
export function formatMoney(n: number) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 2)}M`;
  if (abs >= 1000) return `$${(v / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
  return `$${v.toLocaleString()}`;
}

function treatmentAvg(value?: string | null) {
  return TREATMENT_BY_VALUE[value || '']?.avgValue ?? TREATMENT_BY_VALUE.other.avgValue;
}

function practiceDefaultFor(practice: PracticeLike, treatmentType: string) {
  const defaults = practice?.treatment_defaults;
  const v = defaults && typeof defaults === 'object' ? Number(defaults[treatmentType]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Mirror of web src/lib/treatments.js consultTxValue — tx-plan value + source chain. */
export function consultTxValue(consult: ConsultRow, practice: PracticeLike) {
  const tt = consult?.treatment_type || DEFAULT_TREATMENT;
  const stored = Number(consult?.tx_plan_value);
  if (Number.isFinite(stored) && stored > 0) {
    return { value: stored, source: consult?.tx_plan_value_source || 'manual' };
  }
  const pd = practiceDefaultFor(practice, tt);
  if (pd) return { value: pd, source: 'practice_default' };
  return { value: treatmentAvg(tt), source: 'estimate' };
}

export function isConfirmedSource(source?: string | null) {
  return source === 'pms' || source === 'manual';
}

/** Mirror of web src/lib/attribution.js isAcceptedConsult. */
export function isAcceptedConsult(c: ConsultRow) {
  return (
    ['closed_won', 'recovered'].includes(c?.status || '') ||
    ['accepted', 'closed_won'].includes(c?.outcome || '')
  );
}

function attributedToCaseLift(c: ConsultRow, sentSet: Set<string>, repliedSet: Set<string>) {
  if (c.attribution_status === 'caselift_recovered' || c.attribution_status === 'caselift_assisted') {
    return true;
  }
  if (c.id && repliedSet.has(c.id)) return true;
  if (c.id && sentSet.has(c.id)) return true;
  return false;
}

/**
 * Mirror of web src/lib/dashboard.js computeAttributedProduction — production $
 * from accepted, CaseLift-attributed consults. ROI = confirmed ÷ $997/mo plan.
 */
export function computeAttributedProduction(
  consults: ConsultRow[],
  practice: PracticeLike,
  { sentSet, repliedSet }: { sentSet: Set<string>; repliedSet: Set<string> },
) {
  let confirmed = 0;
  let pipeline = 0;
  let attributedCount = 0;
  for (const c of consults || []) {
    if (!isAcceptedConsult(c)) continue;
    if (!attributedToCaseLift(c, sentSet, repliedSet)) continue;
    const { value, source } = consultTxValue(c, practice);
    attributedCount += 1;
    if (isConfirmedSource(source)) confirmed += value;
    else pipeline += value;
  }
  return {
    confirmed,
    pipeline,
    total: confirmed + pipeline,
    attributedCount,
    roi: confirmed > 0 ? Math.max(1, Math.round(confirmed / 997)) : 0,
  };
}

const SENT_MESSAGE_STATUSES = ['sent', 'delivered', 'opened', 'replied'];

/** Mirror of web src/lib/dashboard.js countSentMessages. */
export function countSentMessages(
  messages: Array<{ status?: string | null; sent_at?: string | null }>,
) {
  return (messages || []).filter(
    (m) => m.status === 'sent' || (m.sent_at && SENT_MESSAGE_STATUSES.includes(m.status || '')),
  ).length;
}

export function isClosedConsult(c: { status?: string; outcome?: string }) {
  return (
    ['closed_won', 'recovered'].includes(c?.status || '') ||
    ['accepted', 'closed_won'].includes(c?.outcome || '')
  );
}

export function closeRateForRows(rows: Array<{ status?: string; outcome?: string }>) {
  const total = rows.length;
  const closed = rows.filter(isClosedConsult).length;
  return total ? Math.round((closed / total) * 100) : 0;
}

export function computeRecordingRate(consults: Array<{ recording_date?: string | null }>) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = consults.filter((c) => String(c.recording_date || '').startsWith(monthKey));
  const recorded = thisMonth.filter((c) => c.recording_date).length;
  return thisMonth.length ? Math.round((recorded / thisMonth.length) * 100) : 0;
}

export function countUnscheduledTxPlans(
  consults: Array<{ outcome?: string; tx_plan_value?: number | null; status?: string }>,
) {
  return consults.filter(
    (c) =>
      c.tx_plan_value &&
      c.tx_plan_value > 0 &&
      !['accepted', 'closed_won'].includes(c.outcome || '') &&
      !['closed_won', 'recovered'].includes(c.status || ''),
  ).length;
}
