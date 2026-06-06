/** Mailgun REST helper for transactional / sequence email. */

export type MailgunAudience = "platform" | "patient";

/** Platform domain (invites, billing, staff digests). Normalized (no scheme/trailing slash). */
export function mailgunPlatformDomain(): string | null {
  const raw = Deno.env.get("MAILGUN_DOMAIN");
  if (!raw) return null;
  return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim() || null;
}

/** Normalize env value that may mistakenly be a full email or URL. */
function mailgunHostEnv(name: string, fallback: string): string {
  let raw = (Deno.env.get(name) || fallback).trim();
  if (raw.includes("@")) {
    const host = raw.split("@").pop()?.trim();
    if (host) raw = host;
  }
  raw = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
  return raw || fallback;
}

/** DNS root for per-practice patient hosts: {subdomain}.mail.heyhope.ai */
export function mailgunPatientMailRoot(): string {
  return mailgunHostEnv("MAILGUN_PATIENT_MAIL_ROOT", "mail.heyhope.ai");
}

/** Mailgun API domain for patient sends (wildcard domain in Mailgun, e.g. mail.heyhope.ai). */
export function mailgunPatientApiDomain(): string {
  return mailgunHostEnv("MAILGUN_PATIENT_MAIL_DOMAIN", mailgunPatientMailRoot());
}

/**
 * Domain that receives patient replies (must have MX in DNS).
 * Defaults to MAILGUN_DOMAIN (e.g. mysmileinbox.com). Per-practice From hosts
 * like gold-dental.mysmileinbox.com are send-only unless you add wildcard MX.
 */
export function mailgunInboundReceiveDomain(): string | null {
  const explicit = Deno.env.get("MAILGUN_INBOUND_DOMAIN");
  if (explicit?.trim()) {
    return mailgunHostEnv("MAILGUN_INBOUND_DOMAIN", mailgunPlatformDomain() || "mail.heyhope.ai");
  }
  return mailgunPlatformDomain() || mailgunPatientApiDomain() || null;
}

export function practiceMailHostname(subdomain: string): string {
  return `${subdomain}.${mailgunPatientMailRoot()}`;
}

export function practiceFromAddress(subdomain: string, localPart = "office"): string {
  return `${localPart}@${practiceMailHostname(subdomain)}`;
}

/** Parse practice mail_subdomain from recipient (reply+uuid@smith.mail.heyhope.ai). */
export function parseMailSubdomainFromRecipient(recipient: string, mailRoot?: string): string | null {
  const root = (mailRoot || mailgunPatientMailRoot()).toLowerCase();
  const raw = String(recipient || "").trim().toLowerCase();
  const email = raw.includes("@") ? (raw.match(/<([^>]+)>/)?.[1] || raw.split("@").pop() || "") : raw;
  const suffix = `.${root}`;
  if (!email.endsWith(suffix) || email === root) return null;
  const sub = email.slice(0, -suffix.length);
  if (!sub || sub.includes(".")) return null;
  return sub;
}

export function isPatientMailRecipient(recipient: string): boolean {
  return parseMailSubdomainFromRecipient(recipient) != null ||
    String(recipient).toLowerCase().includes(`@${mailgunPatientMailRoot().toLowerCase()}`);
}

/** Reply address for two-way conversation email (host = practice subdomain host or legacy domain). */
export function conversationReplyAddress(conversationId: string, mailHost?: string): string | null {
  const host = mailHost || mailgunPlatformDomain();
  if (!host || !conversationId) return null;
  return `reply+${conversationId}@${host}`;
}

/** Parse conversation id from Mailgun recipient, e.g. reply+{uuid}@smith.mail.heyhope.ai */
export function parseConversationIdFromRecipient(recipient: string): string | null {
  const raw = String(recipient || "");
  const m = raw.match(/reply\+([0-9a-fA-F-]{36})/i) || raw.match(/conv\+([0-9a-fA-F-]{36})/i);
  return m?.[1] || null;
}

export function extractEmailAddress(raw: string): string {
  const s = String(raw || "").trim();
  const m = s.match(/<([^>]+)>/);
  return (m?.[1] || s).trim().toLowerCase();
}

export function emailsMatch(a: string, b: string): boolean {
  return extractEmailAddress(a) === extractEmailAddress(b);
}

/** Verify Mailgun inbound-route webhook (timestamp + token HMAC). */
export async function verifyMailgunWebhook(
  signingKey: string,
  timestamp: string,
  token: string,
  signature: string,
): Promise<boolean> {
  if (!signingKey || !timestamp || !token || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(timestamp + token),
  );
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

export type MailgunSendResult =
  | { sent: true; id?: string }
  | { sent: false; reason: string; detail?: string };

export type MailgunFromKind = "noreply" | "digest";

/** Resolved sender address on the platform domain. */
export function mailgunFromAddress(kind: MailgunFromKind = "noreply"): string | null {
  const domain = mailgunPlatformDomain();
  if (!domain) return null;
  const envFrom = Deno.env.get("MAILGUN_FROM");
  const parsed = envFrom?.match(/<([^>]+)>/)?.[1];
  if (parsed) return parsed;
  return kind === "digest" ? `digest@${domain}` : `noreply@${domain}`;
}

export function isMailgunConfigured(): boolean {
  return Boolean(mailgunPlatformDomain() && Deno.env.get("MAILGUN_API_KEY"));
}

export function isPatientMailConfigured(): boolean {
  return Boolean(mailgunPatientApiDomain() && Deno.env.get("MAILGUN_API_KEY"));
}

async function postMailgun(
  apiDomain: string,
  key: string,
  form: FormData,
): Promise<MailgunSendResult> {
  const res = await fetch(`https://api.mailgun.net/v3/${apiDomain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`api:${key}`)}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`Mailgun send failed ${res.status} (${apiDomain}):`, detail);
    return { sent: false, reason: `mailgun_${res.status}`, detail };
  }

  try {
    const data = await res.json();
    return { sent: true, id: data?.id };
  } catch {
    return { sent: true };
  }
}

/** Platform email: invites, billing, staff digests (MAILGUN_DOMAIN). */
export async function sendMailgunMessage(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  replyTo?: string | null;
  fromAddress?: string;
  fromKind?: MailgunFromKind;
  audience?: MailgunAudience;
  mailgunDomain?: string;
}): Promise<MailgunSendResult> {
  const audience = opts.audience ?? "platform";
  const key = Deno.env.get("MAILGUN_API_KEY");
  if (!key) return { sent: false, reason: "mailgun_not_configured" };

  const domain = audience === "patient"
    ? (opts.mailgunDomain || mailgunPatientApiDomain())
    : (opts.mailgunDomain || mailgunPlatformDomain());

  if (!domain) return { sent: false, reason: "mailgun_not_configured" };

  const address = opts.fromAddress ||
    (audience === "platform" ? mailgunFromAddress(opts.fromKind ?? "noreply") : null);
  if (!address) return { sent: false, reason: "missing_from_address" };

  const fromName = opts.fromName || "CaseLift";
  const form = new FormData();
  form.append("from", `${fromName} <${address}>`);
  form.append("to", opts.to);
  form.append("subject", opts.subject);
  form.append("text", opts.text);
  if (opts.html) form.append("html", opts.html);
  if (opts.replyTo) form.append("h:Reply-To", opts.replyTo);

  return postMailgun(domain, key, form);
}

/** Multiple recipients — platform mail only. */
export async function sendMailgunToMany(opts: {
  to: string[];
  subject: string;
  text?: string;
  html: string;
  fromName?: string;
  replyTo?: string | null;
  fromKind?: MailgunFromKind;
}): Promise<MailgunSendResult> {
  const recipients = [...new Set(opts.to.map((e) => e.trim()).filter((e) => /@/.test(e)))];
  if (!recipients.length) return { sent: false, reason: "no_recipient" };

  const domain = mailgunPlatformDomain();
  const key = Deno.env.get("MAILGUN_API_KEY");
  if (!domain || !key) return { sent: false, reason: "mailgun_not_configured" };

  const address = mailgunFromAddress(opts.fromKind ?? "noreply");
  if (!address) return { sent: false, reason: "mailgun_not_configured" };

  const fromName = opts.fromName || "CaseLift";
  const form = new FormData();
  form.append("from", `${fromName} <${address}>`);
  for (const addr of recipients) form.append("to", addr);
  form.append("subject", opts.subject);
  if (opts.text) form.append("text", opts.text);
  form.append("html", opts.html);
  if (opts.replyTo) form.append("h:Reply-To", opts.replyTo);

  return postMailgun(domain, key, form);
}
