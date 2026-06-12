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
