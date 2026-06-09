/** Per-practice patient email (subdomain on platform mail zone). */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  conversationReplyAddress,
  mailgunPatientApiDomain,
  mailgunPatientMailRoot,
  parseMailSubdomainFromRecipient,
  practiceFromAddress,
  practiceMailHostname,
} from "./mailgun.ts";

export type PracticeMailRow = {
  id: string;
  name?: string | null;
  mail_subdomain?: string | null;
  mail_from_local_part?: string | null;
};

export function slugifyPracticeName(name: string): string {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug.length >= 3 ? slug : "";
}

export function defaultMailSubdomain(practiceId: string, practiceName?: string | null): string {
  const fromName = slugifyPracticeName(practiceName || "");
  if (fromName) return fromName;
  return `pr-${practiceId.replace(/-/g, "").slice(0, 12)}`;
}

/** Assign a unique mail_subdomain for the practice (lazy, on first patient email). */
export async function ensurePracticeMailSubdomain(
  admin: SupabaseClient,
  practice: PracticeMailRow,
): Promise<{ subdomain: string; hostname: string; fromAddress: string; apiDomain: string }> {
  const apiDomain = mailgunPatientApiDomain();
  const local = (practice.mail_from_local_part || "office").trim() || "office";

  if (practice.mail_subdomain) {
    const hostname = practiceMailHostname(practice.mail_subdomain);
    return {
      subdomain: practice.mail_subdomain,
      hostname,
      fromAddress: practiceFromAddress(practice.mail_subdomain, local),
      apiDomain,
    };
  }

  const base = defaultMailSubdomain(practice.id, practice.name);
  let candidate = base;

  for (let attempt = 0; attempt < 25; attempt++) {
    const { data: taken } = await admin
      .from("practices")
      .select("id")
      .eq("mail_subdomain", candidate)
      .maybeSingle();

    if (!taken || taken.id === practice.id) {
      const { error } = await admin
        .from("practices")
        .update({ mail_subdomain: candidate })
        .eq("id", practice.id)
        .is("mail_subdomain", null);

      if (!error) {
        const hostname = practiceMailHostname(candidate);
        return {
          subdomain: candidate,
          hostname,
          fromAddress: practiceFromAddress(candidate, local),
          apiDomain,
        };
      }

      const { data: refreshed } = await admin
        .from("practices")
        .select("mail_subdomain, mail_from_local_part")
        .eq("id", practice.id)
        .maybeSingle();
      if (refreshed?.mail_subdomain) {
        const hostname = practiceMailHostname(refreshed.mail_subdomain);
        const loc = (refreshed.mail_from_local_part || "office").trim() || "office";
        return {
          subdomain: refreshed.mail_subdomain,
          hostname,
          fromAddress: practiceFromAddress(refreshed.mail_subdomain, loc),
          apiDomain,
        };
      }
    }

    candidate = `${base}-${attempt + 2}`;
  }

  const fallback = `pr-${practice.id.replace(/-/g, "").slice(0, 12)}`;
  await admin.from("practices").update({ mail_subdomain: fallback }).eq("id", practice.id);
  const hostname = practiceMailHostname(fallback);
  return {
    subdomain: fallback,
    hostname,
    fromAddress: practiceFromAddress(fallback, local),
    apiDomain,
  };
}

export function conversationReplyOnPracticeHost(
  conversationId: string,
  hostname: string,
): string | null {
  return conversationReplyAddress(conversationId, hostname);
}

export type PracticeTrustFooterFields = {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatPracticeLocation(practice: PracticeTrustFooterFields): string | null {
  const cityState = [practice.city?.trim(), practice.state?.trim()].filter(Boolean).join(", ");
  const parts = [practice.address?.trim(), cityState].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** CAN-SPAM trust footer for patient email (Conversations + sequences). */
export function appendPatientEmailTrustFooter(opts: {
  htmlBody: string;
  textBody: string;
  practice: PracticeTrustFooterFields;
}): { html: string; text: string } {
  const name = (opts.practice.name || "your dental practice").trim();
  const location = formatPracticeLocation(opts.practice);
  const phone = opts.practice.phone?.trim();
  const reason = `You're receiving this because you visited ${name}.`;

  const textLines = [name, location, phone, reason].filter(Boolean) as string[];
  const text = `${opts.textBody}\n\n---\n${textLines.join("\n")}`;

  const htmlLines = [
    `<p style="margin:0 0 4px;font-weight:600;color:#374151">${escapeHtml(name)}</p>`,
    location ? `<p style="margin:0 0 4px;color:#6b7280">${escapeHtml(location)}</p>` : "",
    phone ? `<p style="margin:0 0 8px;color:#6b7280">${escapeHtml(phone)}</p>` : "",
    `<p style="margin:0;color:#9ca3af;font-size:12px">${escapeHtml(reason)}</p>`,
  ].filter(Boolean);

  const html =
    `${opts.htmlBody}` +
    `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;line-height:1.5">` +
    htmlLines.join("") +
    `</div>`;

  return { html, text };
}

/** Resolve practice id from inbound recipient host (e.g. smith.mail.heyhope.ai). */
export async function practiceIdFromMailRecipient(
  admin: SupabaseClient,
  recipient: string,
): Promise<string | null> {
  const sub = parseMailSubdomainFromRecipient(recipient, mailgunPatientMailRoot());
  if (!sub) return null;
  const { data } = await admin
    .from("practices")
    .select("id")
    .eq("mail_subdomain", sub)
    .maybeSingle();
  return data?.id || null;
}

/** Find or create a conversation for sequence / consult email reply routing. */
export async function resolveConversationForEmail(
  admin: SupabaseClient,
  practiceId: string,
  consultId: string | null,
  patientEmail: string,
): Promise<string | null> {
  if (!consultId) return null;

  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("practice_id", practiceId)
    .eq("consult_id", consultId)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: consult } = await admin
    .from("consults")
    .select("id, practice_id, patient_first, patient_last, patient_phone, patient_email")
    .eq("id", consultId)
    .eq("practice_id", practiceId)
    .maybeSingle();
  if (!consult) return null;

  const nowIso = new Date().toISOString();
  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      practice_id: practiceId,
      consult_id: consultId,
      patient_first: consult.patient_first,
      patient_last: consult.patient_last,
      patient_phone: consult.patient_phone,
      patient_email: patientEmail || consult.patient_email,
      last_message_at: nowIso,
      last_message_preview: "Email thread",
      unread_count: 0,
    })
    .select("id")
    .single();

  if (error) {
    const { data: race } = await admin
      .from("conversations")
      .select("id")
      .eq("practice_id", practiceId)
      .eq("consult_id", consultId)
      .maybeSingle();
    return race?.id || null;
  }
  return created?.id || null;
}
