import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  CheckCircle2,
  Clock,
  PlayCircle,
  Send,
  StopCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react-native';

import { useAppColors, useAppTheme } from '@/lib/color-scheme-context';

type ConsultLike = {
  outcome?: string | null;
  status?: string | null;
  outcome_set_at?: string | null;
  outcome_note?: string | null;
  followup_approved_at?: string | null;
  sequence_activated_at?: string | null;
  sequence_status?: string | null;
  sequence_paused_reason?: string | null;
  created_at?: string | null;
};

function fmtRemaining(ms: number) {
  if (ms <= 0) return 'now';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

type OutcomeControlsProps = {
  consult: ConsultLike;
  holdHours?: number;
  scheduledCount?: number;
  pending?: boolean;
  onSelect: (outcome: string) => void;
  onStopSequence?: () => void;
  onResumeSequence?: () => void;
};

export function OutcomeControls({
  consult,
  holdHours = 24,
  scheduledCount = 0,
  pending = false,
  onSelect,
  onStopSequence,
  onResumeSequence,
}: OutcomeControlsProps) {
  const c = useAppColors();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const outcome = consult.outcome || 'pending';
  const seqStatus = consult.sequence_status || 'active';
  const paused = seqStatus === 'paused';
  const sequenceStarted = Boolean(
    consult.followup_approved_at ||
      consult.sequence_activated_at ||
      (outcome === 'pending' && consult.outcome_set_at),
  );
  const firstSendAt = consult.created_at
    ? new Date(consult.created_at).getTime() + holdHours * 3600 * 1000
    : 0;
  const remaining = firstSendAt - now;
  const inHold = sequenceStarted && outcome === 'pending' && seqStatus === 'active' && remaining > 0;
  const active = sequenceStarted && outcome === 'pending' && seqStatus === 'active' && remaining <= 0;

  if (outcome === 'accepted' || consult.status === 'closed_won') {
    return (
      <Banner
        icon={CheckCircle2}
        title={
          outcome === 'accepted'
            ? 'Accepted treatment — no follow-up sequence running'
            : 'Closed — treatment confirmed. Follow-up sequence stopped.'
        }
        tone="success"
      />
    );
  }

  if (outcome === 'not_converting' || consult.status === 'closed_lost') {
    return (
      <Banner
        icon={XCircle}
        title="Marked as not a fit"
        sub={consult.outcome_note ? `Note: ${consult.outcome_note}` : undefined}
        tone="muted"
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 8 }}>
        <OutcomeButton
          icon={CheckCircle2}
          label="Accepted treatment"
          tone="success"
          selected={false}
          disabled={pending}
          loading={pending}
          onPress={() => onSelect('accepted')}
        />
        <OutcomeButton
          icon={sequenceStarted ? CheckCircle2 : PlayCircle}
          label={sequenceStarted ? 'Follow-up started' : 'Start follow-up sequence'}
          tone="brand"
          selected={sequenceStarted && !paused}
          disabled={(sequenceStarted && !paused) || pending}
          loading={pending}
          onPress={() => onSelect('pending')}
        />
        <OutcomeButton
          icon={XCircle}
          label="Not a fit"
          tone="muted"
          selected={false}
          disabled={pending}
          loading={pending}
          onPress={() => onSelect('not_converting')}
        />
      </View>

      {paused ? (
        <SlimBar
          icon={StopCircle}
          tone="muted"
          actionLabel="Resume"
          onAction={onResumeSequence}
          busy={pending}>
          {consult.sequence_paused_reason === 'reply'
            ? 'Sequence paused — patient replied. Messages won’t send until resumed.'
            : 'Sequence paused — messages won’t send until resumed.'}
        </SlimBar>
      ) : inHold ? (
        <SlimBar icon={Clock} tone="warning" actionLabel="Stop" onAction={onStopSequence} busy={pending}>
          First message sends in <Text style={{ fontWeight: '700' }}>{fmtRemaining(remaining)}</Text>
        </SlimBar>
      ) : active ? (
        <SlimBar icon={Send} tone="info" actionLabel="Stop" onAction={onStopSequence} busy={pending}>
          Follow-up sequence active · {scheduledCount} message{scheduledCount === 1 ? '' : 's'} scheduled
        </SlimBar>
      ) : null}
    </View>
  );
}

function OutcomeButton({
  icon: Icon,
  label,
  tone,
  selected,
  disabled,
  loading,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  tone: 'success' | 'brand' | 'muted';
  selected: boolean;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  const c = useAppColors();

  const tones = {
    success: {
      fill: { bg: '#16A34A', border: '#16A34A', text: '#FFFFFF', icon: '#FFFFFF' },
      outline: { bg: 'transparent', border: '#16A34A', text: '#16A34A', icon: '#16A34A' },
    },
    brand: {
      fill: { bg: c.accent, border: c.accent, text: '#FFFFFF', icon: '#FFFFFF' },
      outline: { bg: 'transparent', border: c.accent, text: c.accent, icon: c.accent },
    },
    muted: {
      fill: { bg: c.textMuted, border: c.textMuted, text: '#FFFFFF', icon: '#FFFFFF' },
      outline: { bg: 'transparent', border: c.borderStrong, text: c.textSecondary, icon: c.textSecondary },
    },
  };
  const style = selected ? tones[tone].fill : tones[tone].outline;

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 44,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: style.border,
        backgroundColor: pressed && !selected ? c.accentSubtle : style.bg,
        opacity: disabled ? 0.55 : 1,
      })}>
      {loading ? (
        <ActivityIndicator size="small" color={style.icon} />
      ) : (
        <Icon size={16} color={style.icon} />
      )}
      <Text style={{ fontSize: 15, fontWeight: '600', color: style.text }}>{label}</Text>
    </Pressable>
  );
}

function Banner({
  icon: Icon,
  title,
  sub,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  sub?: string;
  tone: 'success' | 'muted';
}) {
  const c = useAppColors();
  const { colorScheme } = useAppTheme();
  const isSuccess = tone === 'success';

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        padding: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: isSuccess ? '#86EFAC' : c.border,
        backgroundColor: isSuccess ? (colorScheme === 'dark' ? '#14532D33' : '#F0FDF4') : c.surfaceHi,
      }}>
      <Icon size={18} color={isSuccess ? '#16A34A' : c.textSecondary} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{title}</Text>
        {sub ? <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 4 }}>{sub}</Text> : null}
      </View>
    </View>
  );
}

function SlimBar({
  icon: Icon,
  tone,
  children,
  actionLabel,
  onAction,
  busy,
}: {
  icon: LucideIcon;
  tone: 'warning' | 'info' | 'muted';
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  const c = useAppColors();
  const { colorScheme } = useAppTheme();
  const tones = {
    warning: {
      border: '#FDE68A',
      bg: colorScheme === 'dark' ? '#78350F33' : '#FFFBEB',
      text: colorScheme === 'dark' ? '#FCD34D' : '#92400E',
      icon: '#D97706',
    },
    info: {
      border: '#BFDBFE',
      bg: colorScheme === 'dark' ? '#1E3A5F33' : '#EFF6FF',
      text: colorScheme === 'dark' ? '#93C5FD' : '#1E40AF',
      icon: '#2563EB',
    },
    muted: {
      border: c.border,
      bg: c.surfaceHi,
      text: c.textSecondary,
      icon: c.textMuted,
    },
  };
  const t = tones[tone];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.bg,
      }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon size={14} color={t.icon} />
        <Text style={{ flex: 1, fontSize: 13, color: t.text }}>{children}</Text>
      </View>
      {onAction && actionLabel ? (
        <Pressable disabled={busy} onPress={onAction} hitSlop={8}>
          {busy ? (
            <ActivityIndicator size="small" color={t.text} />
          ) : (
            <Text style={{ fontSize: 13, fontWeight: '600', color: t.text, textDecorationLine: 'underline' }}>
              {actionLabel}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}
