// Resolve practice + conversation for inbound Twilio SMS/voice (patient → practice number).
import type { SupabaseClient } from "@supabase/supabase-js";
import { phonesMatch, toE164 } from "./twilio.ts";

export interface ResolvedConversation {
  id: string;
  consult_id: string | null;
  patient_first: string | null;
  patient_last: string | null;
  patient_phone: string | null;
  unread_count: number;
}

export async function resolvePracticeFromTwilioNumber(
  admin: SupabaseClient,
  to: string,
  practiceIdHint: string | null,
): Promise<{ id: string } | null> {
  const toE164Norm = toE164(to);

  if (practiceIdHint) {
    const { data: hinted } = await admin
      .from("practices")
      .select("id, twilio_phone_number, twilio_phone_e164")
      .eq("id", practiceIdHint)
      .maybeSingle();
    if (
      hinted &&
      (phonesMatch(hinted.twilio_phone_number || "", to) || hinted.twilio_phone_e164 === toE164Norm)
    ) {
      return { id: hinted.id };
    }
  }

  const { data: byE164 } = await admin
    .from("practices")
    .select("id")
    .eq("twilio_phone_e164", toE164Norm)
    .maybeSingle();
  if (byE164) return { id: byE164.id };

  const { data: practices } = await admin
    .from("practices")
    .select("id, twilio_phone_number")
    .not("twilio_phone_number", "is", null);
  const legacy = (practices || []).find((p) => phonesMatch(p.twilio_phone_number || "", to));
  return legacy ? { id: legacy.id } : null;
}

export async function resolveConversationForPatient(
  admin: SupabaseClient,
  practiceId: string,
  patientPhone: string,
): Promise<{ conversation: ResolvedConversation; created: boolean }> {
  const nowIso = new Date().toISOString();

  const { data: convRows } = await admin
    .from("conversations")
    .select("id, unread_count, opted_out, consult_id, patient_first, patient_last, patient_phone")
    .eq("practice_id", practiceId);

  let conversation = (convRows || []).find((c) => phonesMatch(c.patient_phone || "", patientPhone)) || null;

  let consult: {
    id: string;
    patient_first: string | null;
    patient_last: string | null;
    patient_phone: string | null;
    patient_email: string | null;
  } | null = null;

  if (!conversation) {
    const { data: consults } = await admin
      .from("consults")
      .select("id, patient_first, patient_last, patient_phone, patient_email")
      .eq("practice_id", practiceId)
      .order("created_at", { ascending: false })
      .limit(200);

    consult = (consults || []).find((c) => phonesMatch(c.patient_phone || "", patientPhone)) || null;

    if (consult) {
      const linked = (convRows || []).find((c) => c.consult_id === consult!.id);
      if (linked) conversation = linked;
    }
  }

  if (!conversation) {
    const { data: created, error: createErr } = await admin
      .from("conversations")
      .insert({
        practice_id: practiceId,
        consult_id: consult?.id || null,
        patient_first: consult?.patient_first || null,
        patient_last: consult?.patient_last || null,
        patient_phone: patientPhone,
        patient_email: consult?.patient_email || null,
        last_message_at: nowIso,
        last_message_preview: "📞 Inbound call",
        unread_count: 1,
      })
      .select("id, unread_count, consult_id, patient_first, patient_last, patient_phone")
      .single();
    if (createErr) throw new Error(createErr.message);
    return { conversation: created as ResolvedConversation, created: true };
  }

  await admin
    .from("conversations")
    .update({
      last_message_at: nowIso,
      last_message_preview: "📞 Inbound call",
      unread_count: (conversation.unread_count || 0) + 1,
    })
    .eq("id", conversation.id);

  return {
    conversation: {
      id: conversation.id,
      consult_id: conversation.consult_id,
      patient_first: conversation.patient_first,
      patient_last: conversation.patient_last,
      patient_phone: conversation.patient_phone,
      unread_count: (conversation.unread_count || 0) + 1,
    },
    created: false,
  };
}

/** Twilio Client identity for a practice (must match twilio-voice-token). */
export function practiceClientIdentity(practiceId: string): string {
  return `practice_${String(practiceId).replace(/[^a-zA-Z0-9._-]/g, "")}`;
}
