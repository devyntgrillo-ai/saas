// Shared Twilio helpers for SMS edge functions.

/** Strip to digits; US numbers normalize to 10-digit core for matching. */
export function phoneDigits(phone: string): string {
  return String(phone || "").replace(/\D/g, "");
}

/** Compare two phone strings (handles +1, dashes, parens). */
export function phonesMatch(a: string, b: string): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  const core = (d: string) => (d.length === 11 && d.startsWith("1") ? d.slice(1) : d);
  return core(da) === core(db) || da.endsWith(db) || db.endsWith(da);
}

/** Format for Twilio REST API (prefer E.164 for US). */
export function toE164(phone: string): string {
  const d = phoneDigits(phone);
  if (!d) return phone;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return phone.startsWith("+") ? phone : `+${d}`;
}

export interface TwilioConfig {
  accountSid: string;
  /** API key auth (preferred for production). */
  apiKeySid: string | null;
  apiKeySecret: string | null;
  /** Account auth token, enough for SMS send + webhook signature validation. */
  authToken: string | null;
  callerIdFallback: string | null;
  webhookBase: string | null;
}

function publicWebhookBase(base: string | null): string | null {
  if (!base) return null;
  if (base.includes("kong") || base.includes("127.0.0.1") || base.includes("localhost")) return null;
  return base.startsWith("https://") ? base.replace(/\/$/, "") : null;
}

export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") || null;
  const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID") || null;
  const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET") || null;
  if (!accountSid) return null;
  const hasApiKey = !!(apiKeySid && apiKeySecret);
  const hasAuthToken = !!authToken;
  if (!hasApiKey && !hasAuthToken) return null;
  const webhookRaw = Deno.env.get("TWILIO_WEBHOOK_BASE_URL") || Deno.env.get("SUPABASE_URL") || null;
  return {
    accountSid,
    apiKeySid: hasApiKey ? apiKeySid : null,
    apiKeySecret: hasApiKey ? apiKeySecret : null,
    authToken,
    callerIdFallback: Deno.env.get("TWILIO_CALLER_ID") || null,
    webhookBase: publicWebhookBase(webhookRaw),
  };
}

function twilioBasicAuth(cfg: TwilioConfig): string {
  if (cfg.apiKeySid && cfg.apiKeySecret) {
    return btoa(`${cfg.apiKeySid}:${cfg.apiKeySecret}`);
  }
  if (cfg.authToken) {
    return btoa(`${cfg.accountSid}:${cfg.authToken}`);
  }
  throw new Error("No Twilio credentials configured");
}

const STOP_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);

export function isOptOutMessage(body: string): boolean {
  const word = String(body || "").trim().toLowerCase().split(/\s+/)[0] || "";
  return STOP_KEYWORDS.has(word);
}

export interface SendSmsParams {
  /** E.164 sender when not using a Messaging Service. */
  from?: string;
  /** Preferred for A2P-registered practices (10DLC campaign on the service). */
  messagingServiceSid?: string;
  to: string;
  body: string;
  mediaUrl?: string;
  statusCallback?: string;
}

export interface SendSmsResult {
  sid: string;
  status: string;
}

/** Send an SMS via Twilio REST API (API key or Account SID + Auth Token). */
export async function sendSms(cfg: TwilioConfig, params: SendSmsParams): Promise<SendSmsResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;
  const form = new URLSearchParams();
  const mgSid = params.messagingServiceSid?.trim();
  if (mgSid) {
    form.set("MessagingServiceSid", mgSid);
  } else if (params.from) {
    form.set("From", toE164(params.from));
  } else {
    throw new Error("Twilio send requires MessagingServiceSid or From");
  }
  form.set("To", toE164(params.to));
  form.set("Body", params.body);
  if (params.mediaUrl) form.set("MediaUrl", params.mediaUrl);
  if (params.statusCallback) form.set("StatusCallback", params.statusCallback);

  const auth = twilioBasicAuth(cfg);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string }).message || res.statusText;
    throw new Error(`Twilio send failed (${res.status}): ${msg}`);
  }
  return { sid: String((data as { sid?: string }).sid || ""), status: String((data as { status?: string }).status || "queued") };
}

/** URL Twilio used to sign the request (public tunnel URL + /functions/v1/... path). */
export function twilioWebhookUrl(req: Request, publicBase: string | null, functionName: string): string {
  if (!publicBase) return req.url;
  const search = new URL(req.url).search;
  return `${publicBase.replace(/\/$/, "")}/functions/v1/${functionName}${search}`;
}

/** Optional Twilio webhook signature check (requires TWILIO_AUTH_TOKEN). */
export async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  if (!signature) return false;
  const sorted = Object.keys(params).sort();
  let payload = url;
  for (const k of sorted) payload += k + params[k];

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return expected === signature;
}

export function formDataToRecord(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
