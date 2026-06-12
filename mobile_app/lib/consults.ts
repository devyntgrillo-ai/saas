export const CONSULT_STATUS: Record<string, { label: string }> = {
  pending: { label: 'Pending' },
  approved: { label: 'Approved' },
  active: { label: 'Active' },
  replied: { label: 'Replied' },
  closed_won: { label: 'Converted' },
  closed_lost: { label: 'Not converting' },
  analyzing: { label: 'Analyzing' },
  transcribed: { label: 'Transcribed' },
  transcription_error: { label: 'Transcription Error' },
  analyzed: { label: 'Analyzed' },
  recovered: { label: 'Recovered' },
};

export function statusMeta(status?: string | null) {
  return CONSULT_STATUS[status || ''] || { label: status || 'Unknown' };
}

export function formatDuration(sec?: number | null) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function consultTranscript(consult: {
  transcript?: string | null;
  transcript_deidentified?: string | null;
}) {
  return consult.transcript_deidentified || consult.transcript || null;
}

export function isConsultTranscribing(status?: string | null) {
  return status === 'analyzing';
}

export function isConsultAnalyzing(status?: string | null) {
  return status === 'transcribed';
}

export function isConsultStillProcessing(status?: string | null) {
  return status === 'analyzing' || status === 'transcribed';
}

export function formatDate(d?: string | null) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}
