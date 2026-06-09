/** Shared patient email reply handling for mailgun-inbound + legacy mailgun-webhook route. */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emailsMatch,
  extractEmailAddress,
  isPatientMailRecipient,
  mailgunPlatformDomain,
  parseConversationIdFromRecipient,
} from "./mailgun.ts";
import { practiceIdFromMailRecipient } from "./mailgun-practice.ts";

function preview(text: string, max = 80): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function isAutoSender(email: string): boolean {
  const e = email.toLowerCase();
  return e.includes("mailer-daemon") || e.includes("postmaster") || e.includes("noreply@");
}

function isLegacyPlatformRecipient(recipient: string): boolean {
  const platform = (mailgunPlatformDomain() || "").toLowerCase();
  if (!platform) return false;
  return recipient.toLowerCase().includes(`@${platform}`);
}

export type PatientInboundResult =
  | { handled: true; conversationId: string }
  | { handled: false; reason: string };

type ConvRow = {
  id: string;
  practice_id: string;
  unread_count: number | null;
  consult_id: string | null;
  patient_first: string | null;
  patient_last: string | null;
  patient_phone: string | null;
  patient_email: string | null;
};

/** Process a Mailgun inbound form payload (patient reply). */
export async function processPatientEmailInbound(
  admin: SupabaseClient,
  form: FormData,
  logPrefix = "mailgun-inbound",
): Promise<PatientInboundResult> {
  const sender = String(form.get("sender") || form.get("from") || "").trim();
  const recipient = String(form.get("recipient") || form.get("To") || "").trim();
  const subject = String(form.get("subject") || "").trim();
  const body = String(
    form.get("stripped-text") || form.get("body-plain") || form.get("body") || "",
  ).trim();

  if (!sender) return { handled: false, reason: "no_sender" };

  const fromEmail = extractEmailAddress(sender);
  if (isAutoSender(fromEmail)) return { handled: false, reason: "auto_sender" };

  const hasReplyToken = Boolean(parseConversationIdFromRecipient(recipient));
  if (!hasReplyToken && !isPatientMailRecipient(recipient) && !isLegacyPlatformRecipient(recipient)) {
    return { handled: false, reason: "not_patient_recipient" };
  }

  const scopedPracticeId = await practiceIdFromMailRecipient(admin, recipient);
  const nowIso = new Date().toISOString();
  let conversationId = parseConversationIdFromRecipient(recipient);

  let conversation: ConvRow | null = null;

  if (conversationId) {
    const { data } = await admin
      .from("conversations")
      .select("id, practice_id, unread_count, consult_id, patient_first, patient_last, patient_phone, patient_email")
      .eq("id", conversationId)
      .maybeSingle();
    if (data) {
      if (scopedPracticeId && data.practice_id !== scopedPracticeId) {
        console.warn(`${logPrefix}: conversation practice mismatch`);
        return { handled: false, reason: "practice_mismatch" };
      }
      conversation = data;
    }
  }

  if (!conversation) {
    let convQuery = admin
      .from("conversations")
      .select("id, practice_id, unread_count, consult_id, patient_first, patient_last, patient_phone, patient_email, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(200);

    if (scopedPracticeId) {
      convQuery = convQuery.eq("practice_id", scopedPracticeId);
    }

    const { data: convRows } = await convQuery;
    conversation = (convRows || []).find((c) => emailsMatch(c.patient_email || "", fromEmail)) || null;

    if (!conversation) {
      let consultQuery = admin
        .from("consults")
        .select("id, practice_id, patient_first, patient_last, patient_phone, patient_email")
        .order("created_at", { ascending: false })
        .limit(200);

      if (scopedPracticeId) {
        consultQuery = consultQuery.eq("practice_id", scopedPracticeId);
      }

      const { data: consults } = await consultQuery;
      const consult = (consults || []).find((c) => emailsMatch(c.patient_email || "", fromEmail)) || null;
      if (consult) {
        const linked = (convRows || []).find((c) => c.consult_id === consult.id);
        if (linked) {
          conversation = linked;
        } else {
          const { data: created, error: createErr } = await admin
            .from("conversations")
            .insert({
              practice_id: consult.practice_id,
              consult_id: consult.id,
              patient_first: consult.patient_first,
              patient_last: consult.patient_last,
              patient_phone: consult.patient_phone,
              patient_email: fromEmail,
              last_message_at: nowIso,
              last_message_preview: preview(body || subject || "(email)"),
              unread_count: 1,
            })
            .select("id, practice_id, unread_count, consult_id, patient_first, patient_last, patient_phone, patient_email")
            .single();
          if (createErr) {
            console.error(`${logPrefix}: conversation create failed:`, createErr.message);
            return { handled: false, reason: "conversation_create_failed" };
          }
          conversation = created;
        }
      }
    }
  }

  if (!conversation) {
    console.warn(`${logPrefix}: no conversation for from=${fromEmail} recipient=${recipient}`);
    return { handled: false, reason: "no_conversation" };
  }

  conversationId = conversation.id;

  await admin.from("conversations").update({
    last_message_at: nowIso,
    last_message_preview: preview(body || subject || "(email)"),
    unread_count: (conversation.unread_count || 0) + 1,
    patient_email: conversation.patient_email || fromEmail,
  }).eq("id", conversationId);

  await admin.from("conversation_messages").insert({
    conversation_id: conversationId,
    direction: "inbound",
    channel: "email",
    body: body || subject || "(empty email)",
    sent_at: nowIso,
    meta: {
      mailgun_inbound: true,
      from: sender,
      from_email: fromEmail,
      to: recipient,
      subject: subject || null,
      practice_id: conversation.practice_id,
    },
  });

  try {
    const patientName = [conversation.patient_first, conversation.patient_last].filter(Boolean).join(" ") || fromEmail;
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        practice_id: conversation.practice_id,
        event_name: "patient_replied",
        payload: { patient_name: patientName, message_preview: String(body || subject || "").slice(0, 100) },
      }),
    });
  } catch { /* non-blocking */ }

  return { handled: true, conversationId };
}
