import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { format } from 'date-fns';
import { ArrowLeft, Calendar, Mic, User } from 'lucide-react-native';
import { useAuth, type Practice } from '@/lib/auth-context';
import { useAppColors } from '@/lib/color-scheme-context';
import {
  fetchTodaysAppointments,
  formatAppointmentType,
  searchPmsPatients,
  type PmsAppointment,
  type PmsPatient,
} from '@/lib/pms';
import { DEFAULT_TREATMENT, normalizeTreatment, treatmentLabel } from '@/lib/treatments';
import type { RecordingPatient } from '@/lib/recording';
import { AppButton } from '@/components/ui/AppButton';
import { AppInput } from '@/components/ui/AppInput';
import { FilterChip } from '@/components/ui/FilterChip';
import { SearchBar } from '@/components/ui/SearchBar';
import { UserAvatar } from '@/components/ui/UserAvatar';

type Tab = 'appointment' | 'patient' | 'new';
type Mode = 'choose' | 'confirm';

const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const digits = (p: string) => p.replace(/\D/g, '');
const isUSPhone = (p: string) => {
  const d = digits(p);
  return d.length === 10 || (d.length === 11 && d[0] === '1');
};

function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(' ') || 'Unknown patient';
}

type Props = {
  onConfirm: (patient: RecordingPatient) => void;
  onCancel?: () => void;
};

function soloDoctor(practice: Practice | null) {
  if (Array.isArray(practice?.doctors) && practice.doctors.length === 1) {
    return String(practice.doctors[0] || '').trim();
  }
  return [practice?.doctor_first, practice?.doctor_last].filter(Boolean).join(' ').trim();
}

export function RecordingAssignment({ onConfirm, onCancel }: Props) {
  const c = useAppColors();
  const { practiceId, practice, profile, user } = useAuth();

  const [mode, setMode] = useState<Mode>('choose');
  const [tab, setTab] = useState<Tab>('appointment');
  const [appts, setAppts] = useState<PmsAppointment[] | null>(null);
  const [apptSearch, setApptSearch] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<PmsPatient[] | null>(null);
  const [pmsPatient, setPmsPatient] = useState<PmsPatient | null>(null);
  const [selected, setSelected] = useState<PmsAppointment | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [contact, setContact] = useState({ phone: '', email: '' });

  useEffect(() => {
    if (!practiceId) return;
    let cancelled = false;
    void fetchTodaysAppointments(practiceId).then((rows) => {
      if (!cancelled) setAppts(rows.filter((a) => !a.consult_id));
    });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  useEffect(() => {
    if (mode !== 'choose' || tab !== 'patient' || !practiceId) return;
    let cancelled = false;
    setPatientResults(null);
    const t = setTimeout(() => {
      void searchPmsPatients(practiceId, patientSearch).then((rows) => {
        if (!cancelled) setPatientResults(rows);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mode, tab, patientSearch, practiceId]);

  const filteredAppts = useMemo(() => {
    const q = apptSearch.trim().toLowerCase();
    return (appts || []).filter((a) => !q || fullName(a.patient_first, a.patient_last).toLowerCase().includes(q));
  }, [appts, apptSearch]);

  const apptTreatment = (a: PmsAppointment) =>
    normalizeTreatment(a.treatment_type || a.appointment_type) || DEFAULT_TREATMENT;

  const pmsTx = Number(selected?.tx_plan_value);
  const hasPmsTx = Number.isFinite(pmsTx) && pmsTx > 0;
  const treatmentType = selected ? apptTreatment(selected) : DEFAULT_TREATMENT;
  const treatmentExtras = {
    treatmentType,
    txPlanValue: hasPmsTx ? pmsTx : '',
    txPlanValueSource: hasPmsTx ? 'pms' : 'estimate',
    presentingDoctor: (selected?.provider || soloDoctor(practice) || '').trim(),
    tcName: (profile?.display_name || profile?.full_name || user?.email || '').trim(),
  };

  const patient: RecordingPatient = selected
    ? {
        firstName: selected.patient_first || '',
        lastName: selected.patient_last || '',
        phone: contact.phone,
        email: contact.email,
        appointmentId: selected.id,
        pmsApptId: selected.pms_appointment_id || selected.id,
        ...treatmentExtras,
      }
    : {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email,
        appointmentId: undefined,
        pmsApptId: undefined,
        pmsPatientId: pmsPatient?.id || undefined,
        ...treatmentExtras,
      };

  const phoneOk = isUSPhone(patient.phone || '');
  const emailOk = isEmail(patient.email || '');
  const complete = phoneOk && emailOk;
  const apptMissingContact =
    Boolean(selected) && (!selected?.patient_phone || !selected?.patient_email);

  function pickAppt(a: PmsAppointment) {
    setSelected(a);
    setPmsPatient(null);
    setContact({ phone: a.patient_phone || '', email: a.patient_email || '' });
    setMode('confirm');
  }

  function pickPatient(p: PmsPatient) {
    setSelected(null);
    setPmsPatient(p);
    setForm({
      firstName: p.first_name || '',
      lastName: p.last_name || '',
      phone: p.phone || '',
      email: p.email || '',
    });
    setMode('confirm');
  }

  function backToChoose() {
    setSelected(null);
    setPmsPatient(null);
    setMode('choose');
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {mode === 'confirm' ? (
            <Pressable onPress={backToChoose} style={{ padding: 4 }}>
              <ArrowLeft size={22} color={c.text} />
            </Pressable>
          ) : null}
          <Mic size={20} color={c.record} />
          <Text style={{ fontSize: 22, fontWeight: '700', color: c.text, flex: 1 }}>
            {mode === 'confirm' ? 'Confirm patient' : 'Who are you recording?'}
          </Text>
        </View>
        {mode === 'choose' ? (
          <Text style={{ fontSize: 14, color: c.textSecondary, marginTop: 6 }}>
            Link to today's consult, search your patient list, or add a new patient
          </Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}>
        {mode === 'confirm' ? (
          <>
            <View
              style={{
                backgroundColor: '#FEF3C7',
                borderRadius: 10,
                padding: 14,
              }}>
              <Text style={{ color: '#92400E', fontSize: 13, lineHeight: 20 }}>
                Consent required: Inform the patient this consult will be recorded for training and
                quality improvement. Wait for verbal confirmation before proceeding.
              </Text>
            </View>

            <View
              style={{
                borderRadius: 14,
                borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.surface,
                padding: 16,
              }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: c.textMuted, letterSpacing: 0.5 }}>
                RECORDING CONSULT FOR
              </Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: c.text, marginTop: 6 }}>
                {fullName(patient.firstName, patient.lastName) || 'New patient'}
              </Text>
              {selected ? (
                <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 4 }}>
                  {formatAppointmentType(selected, practice)} ·{' '}
                  {selected.appointment_time
                    ? format(new Date(selected.appointment_time), 'h:mm a')
                    : ''}
                </Text>
              ) : null}
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 8 }}>
                Treatment: {treatmentLabel(treatmentType)}
                {hasPmsTx ? ` · $${pmsTx.toLocaleString()}` : ''}
                {' · editable after recording'}
              </Text>
            </View>

            {selected && !apptMissingContact ? (
              <View style={{ gap: 8 }}>
                <Row label="Phone" value={patient.phone} />
                <Row label="Email" value={patient.email} />
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {apptMissingContact ? (
                  <Text style={{ fontSize: 12, color: c.warning }}>
                    Contact info missing from PMS — please enter below.
                  </Text>
                ) : null}
                <AppInput
                  label="Phone *"
                  value={selected ? contact.phone : form.phone}
                  onChangeText={(v) =>
                    selected ? setContact((x) => ({ ...x, phone: v })) : setForm((f) => ({ ...f, phone: v }))
                  }
                  placeholder="(509) 555-0182"
                  keyboardType="phone-pad"
                  error={patient.phone && !phoneOk ? 'Enter a valid US phone number' : undefined}
                />
                <AppInput
                  label="Email *"
                  value={selected ? contact.email : form.email}
                  onChangeText={(v) =>
                    selected ? setContact((x) => ({ ...x, email: v })) : setForm((f) => ({ ...f, email: v }))
                  }
                  placeholder="patient@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  error={patient.email && !emailOk ? 'Enter a valid email address' : undefined}
                />
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              {onCancel ? (
                <View style={{ flex: 1 }}>
                  <AppButton label="Cancel" variant="outline" onPress={onCancel} />
                </View>
              ) : null}
              <View style={{ flex: 2 }}>
                <AppButton
                  label="Start Recording"
                  onPress={() => onConfirm(patient)}
                  disabled={!complete}
                />
              </View>
            </View>
          </>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <FilterChip
                label="Today's Consults"
                active={tab === 'appointment'}
                onPress={() => setTab('appointment')}
              />
              <FilterChip label="Select Patient" active={tab === 'patient'} onPress={() => setTab('patient')} />
              <FilterChip label="Add Patient" active={tab === 'new'} onPress={() => setTab('new')} />
            </ScrollView>

            {tab === 'appointment' ? (
              <>
                <SearchBar
                  value={apptSearch}
                  onChangeText={setApptSearch}
                  placeholder="Search today's patients…"
                />
                {appts === null ? (
                  <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />
                ) : filteredAppts.length === 0 ? (
                  <EmptyState
                    icon={<Calendar size={28} color={c.textMuted} />}
                    title="No appointments remaining today"
                    subtitle='Use "Select Patient" or "Add Patient" to record without a today appointment.'
                  />
                ) : (
                  filteredAppts.map((a) => {
                    const name = fullName(a.patient_first, a.patient_last);
                    const time = a.appointment_time
                      ? format(new Date(a.appointment_time), 'h:mm a')
                      : '';
                    return (
                      <Pressable key={a.id} onPress={() => pickAppt(a)}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 12,
                            padding: 14,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: c.border,
                            backgroundColor: c.surface,
                            marginBottom: 8,
                          }}>
                          <Text style={{ width: 64, fontSize: 12, color: c.textSecondary }}>{time}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{name}</Text>
                            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                              {formatAppointmentType(a, practice)}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </>
            ) : null}

            {tab === 'patient' ? (
              <>
                <SearchBar
                  value={patientSearch}
                  onChangeText={setPatientSearch}
                  placeholder="Search all patients…"
                />
                {patientResults === null ? (
                  <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} />
                ) : patientResults.length === 0 ? (
                  <EmptyState
                    icon={<User size={28} color={c.textMuted} />}
                    title={patientSearch.trim() ? 'No matching patients' : 'No patients synced yet'}
                    subtitle='Connect your PMS or use "Add Patient".'
                  />
                ) : (
                  patientResults.map((p) => {
                    const name = fullName(p.first_name, p.last_name) || 'Unnamed patient';
                    return (
                      <Pressable key={p.id} onPress={() => pickPatient(p)}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 12,
                            padding: 14,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: c.border,
                            backgroundColor: c.surface,
                            marginBottom: 8,
                          }}>
                          <UserAvatar name={name} size={36} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{name}</Text>
                            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                              {p.phone || p.email || 'No contact on file'}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </>
            ) : null}

            {tab === 'new' ? (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <AppInput
                      label="First name"
                      value={form.firstName}
                      onChangeText={(v) => setForm((f) => ({ ...f, firstName: v }))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppInput
                      label="Last name"
                      value={form.lastName}
                      onChangeText={(v) => setForm((f) => ({ ...f, lastName: v }))}
                    />
                  </View>
                </View>
                <AppInput
                  label="Phone *"
                  value={form.phone}
                  onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                  placeholder="(509) 555-0182"
                  keyboardType="phone-pad"
                  error={form.phone && !isUSPhone(form.phone) ? 'Enter a valid US phone number' : undefined}
                />
                <AppInput
                  label="Email *"
                  value={form.email}
                  onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
                  placeholder="patient@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  error={form.email && !isEmail(form.email) ? 'Enter a valid email address' : undefined}
                />
                <AppButton
                  label="Continue"
                  onPress={() => {
                    setPmsPatient(null);
                    setSelected(null);
                    setMode('confirm');
                  }}
                  disabled={!isUSPhone(form.phone) || !isEmail(form.email)}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  const c = useAppColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: c.textSecondary, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.text, fontSize: 14, flex: 1, textAlign: 'right' }} numberOfLines={1}>
        {value || '—'}
      </Text>
    </View>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  const c = useAppColors();
  return (
    <View
      style={{
        alignItems: 'center',
        padding: 28,
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: c.border,
        marginTop: 8,
      }}>
      {icon}
      <Text style={{ fontSize: 15, color: c.textSecondary, marginTop: 12, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 6, textAlign: 'center' }}>{subtitle}</Text>
    </View>
  );
}
