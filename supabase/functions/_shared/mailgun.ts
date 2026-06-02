/** Mailgun REST helper for transactional / sequence email. */

export type MailgunSendResult =
  | { sent: true; id?: string }
  | { sent: false; reason: string; detail?: string };

export async function sendMailgunMessage(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  fromName?: string;
  replyTo?: string | null;
}): Promise<MailgunSendResult> {
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  const key = Deno.env.get("MAILGUN_API_KEY");
  if (!domain || !key) {
    return { sent: false, reason: "mailgun_not_configured" };
  }

  const envFrom = Deno.env.get("MAILGUN_FROM");
  const address = envFrom?.match(/<([^>]+)>/)?.[1] || `noreply@${domain}`;
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
