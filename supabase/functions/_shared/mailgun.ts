/** Mailgun REST helper for transactional / sequence email. */

/** Reply address for two-way conversation email (Mailgun inbound route). */
export function conversationReplyAddress(conversationId: string, domain?: string): string | null {
  const d = domain || Deno.env.get("MAILGUN_DOMAIN");
  if (!d || !conversationId) return null;
  return `reply+${conversationId}@${d}`;
}

/** Parse conversation id from Mailgun recipient, e.g. reply+{uuid}@mg.example.com */
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

/** Resolved sender address (local part @ MAILGUN_DOMAIN). */
export function mailgunFromAddress(kind: MailgunFromKind = "noreply"): string | null {
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  if (!domain) return null;
  const envFrom = Deno.env.get("MAILGUN_FROM");
  const parsed = envFrom?.match(/<([^>]+)>/)?.[1];
  if (parsed) return parsed;
  return kind === "digest" ? `digest@${domain}` : `noreply@${domain}`;
}

export function isMailgunConfigured(): boolean {
  return Boolean(Deno.env.get("MAILGUN_DOMAIN") && Deno.env.get("MAILGUN_API_KEY"));
}

export async function sendMailgunMessage(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  replyTo?: string | null;
  fromAddress?: string;
  fromKind?: MailgunFromKind;
}): Promise<MailgunSendResult> {
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  const key = Deno.env.get("MAILGUN_API_KEY");
  if (!domain || !key) {
    return { sent: false, reason: "mailgun_not_configured" };
  }

  const address = opts.fromAddress || mailgunFromAddress(opts.fromKind ?? "noreply");
  if (!address) return { sent: false, reason: "mailgun_not_configured" };

  const fromName = opts.fromName || "Hope AI";
  const form = new FormData();
  form.append("from", `${fromName} <${address}>`);
  form.append("to", opts.to);
  form.append("subject", opts.subject);
  form.append("text", opts.text);
  if (opts.html) form.append("html", opts.html);
  if (opts.replyTo) form.append("h:Reply-To", opts.replyTo);

  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`api:${key}`)}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`Mailgun send failed ${res.status}:`, detail);
    return { sent: false, reason: `mailgun_${res.status}`, detail };
  }

  try {
    const data = await res.json();
    return { sent: true, id: data?.id };
  } catch {
    return { sent: true };
  }
}

/** Multiple recipients in one Mailgun request (deduped). */
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

  const domain = Deno.env.get("MAILGUN_DOMAIN");
  const key = Deno.env.get("MAILGUN_API_KEY");
  if (!domain || !key) return { sent: false, reason: "mailgun_not_configured" };

  const address = mailgunFromAddress(opts.fromKind ?? "noreply");
  if (!address) return { sent: false, reason: "mailgun_not_configured" };

  const fromName = opts.fromName || "Hope AI";
  const form = new FormData();
  form.append("from", `${fromName} <${address}>`);
  for (const addr of recipients) form.append("to", addr);
  form.append("subject", opts.subject);
  if (opts.text) form.append("text", opts.text);
  form.append("html", opts.html);
  if (opts.replyTo) form.append("h:Reply-To", opts.replyTo);

  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`api:${key}`)}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`Mailgun send failed ${res.status}:`, detail);
    return { sent: false, reason: `mailgun_${res.status}`, detail };
  }

  try {
    const data = await res.json();
    return { sent: true, id: data?.id };
  } catch {
    return { sent: true };
  }
}
