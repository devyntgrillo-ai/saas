// Low-level Twilio REST helpers (Account SID + Auth Token or API key).
import type { TwilioConfig } from "./twilio.ts";
import { getTwilioConfig } from "./twilio.ts";

function authHeader(cfg: TwilioConfig): string {
  if (cfg.apiKeySid && cfg.apiKeySecret) {
    return `Basic ${btoa(`${cfg.apiKeySid}:${cfg.apiKeySecret}`)}`;
  }
  if (cfg.authToken) {
    return `Basic ${btoa(`${cfg.accountSid}:${cfg.authToken}`)}`;
  }
  throw new Error("No Twilio credentials configured");
}

export async function twilioRequest<T = Record<string, unknown>>(
  cfg: TwilioConfig,
  base: "api" | "messaging",
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const host = base === "messaging"
    ? "https://messaging.twilio.com"
    : `https://api.twilio.com/2010-04-01`;
  const url = path.startsWith("http") ? path : `${host}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader(cfg));
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }
  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({})) as T & { message?: string };
  if (!res.ok) {
    const msg = (data as { message?: string }).message || res.statusText;
    throw new Error(`Twilio ${res.status}: ${msg}`);
  }
  return data;
}

export function cfgOrThrow(): TwilioConfig {
  const cfg = getTwilioConfig();
  if (!cfg) throw new Error("Twilio isn't configured");
  return cfg;
}

export function inboundWebhookUrl(): string | null {
  const base = Deno.env.get("TWILIO_WEBHOOK_BASE_URL") || null;
  if (!base || base.includes("kong") || base.includes("127.0.0.1")) return null;
  return `${base.replace(/\/$/, "")}/functions/v1/twilio-inbound`;
}

/** Map Twilio brand/campaign status strings to our enum. */
export function mapA2pStatus(raw: string | undefined): "pending" | "approved" | "failed" | "unregistered" {
  const s = String(raw || "").toUpperCase();
  if (["APPROVED", "VERIFIED", "ACTIVE"].includes(s)) return "approved";
  if (["FAILED", "REJECTED", "SUSPENDED", "DELETED"].includes(s)) return "failed";
  if (["PENDING", "IN_REVIEW", "REVIEWING", "SUBMITTED", "REGISTERED"].includes(s)) return "pending";
  return "unregistered";
}

export function a2pDevAutoApprove(): boolean {
  return Deno.env.get("TWILIO_A2P_DEV_AUTO_APPROVE") === "true";
}

export function a2pSkipEnforcement(): boolean {
  return Deno.env.get("TWILIO_A2P_SKIP_ENFORCEMENT") === "true" || a2pDevAutoApprove();
}
