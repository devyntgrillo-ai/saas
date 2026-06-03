// Per-practice SMS send context (single Twilio account, tenant isolation).
import type { TwilioConfig } from "./twilio.ts";
import { toE164 } from "./twilio.ts";
import { a2pSkipEnforcement } from "./twilio-api.ts";

export interface PracticeSmsRow {
  id: string;
  sms_enabled?: boolean | null;
  twilio_phone_number?: string | null;
  twilio_phone_e164?: string | null;
  twilio_messaging_service_sid?: string | null;
  a2p_brand_status?: string | null;
  a2p_campaign_status?: string | null;
}

export type TwilioSmsBlockCode =
  | "sms_disabled"
  | "no_from_number"
  | "a2p_pending";

export type TwilioSmsSendMode = "messaging_service" | "from_number" | "dev_fallback";

export type TwilioSmsContext =
  | {
    ok: true;
    mode: TwilioSmsSendMode;
    messagingServiceSid?: string;
    from?: string;
    a2pApproved: boolean;
  }
  | {
    ok: false;
    error: string;
    code: TwilioSmsBlockCode;
    a2p_brand_status?: string | null;
    a2p_campaign_status?: string | null;
  };

export function a2pApproved(practice: PracticeSmsRow): boolean {
  return practice.a2p_brand_status === "approved" && practice.a2p_campaign_status === "approved";
}

/** Resolve outbound SMS transport for a practice (no shared number in production). */
export function resolveTwilioSmsContext(
  practice: PracticeSmsRow,
  cfg: TwilioConfig,
): TwilioSmsContext {
  if (practice.sms_enabled === false) {
    return { ok: false, error: "SMS is disabled for this practice.", code: "sms_disabled" };
  }

  const fromNumber = practice.twilio_phone_number
    ? toE164(practice.twilio_phone_number)
    : null;
  const approved = a2pApproved(practice);
  const skip = a2pSkipEnforcement();

  if (!fromNumber) {
    if (skip && cfg.callerIdFallback) {
      return {
        ok: true,
        mode: "dev_fallback",
        from: toE164(cfg.callerIdFallback),
        a2pApproved: false,
      };
    }
    return {
      ok: false,
      error: "No Twilio phone number configured for this practice. Complete Phone & Messaging setup.",
      code: "no_from_number",
    };
  }

  if (!approved && !skip) {
    return {
      ok: false,
      error: "SMS registration is pending. Complete A2P setup in Settings → Phone & Messaging.",
      code: "a2p_pending",
      a2p_brand_status: practice.a2p_brand_status,
      a2p_campaign_status: practice.a2p_campaign_status,
    };
  }

  const mgSid = practice.twilio_messaging_service_sid?.trim() || null;
  if (approved && mgSid) {
    return {
      ok: true,
      mode: "messaging_service",
      messagingServiceSid: mgSid,
      from: fromNumber,
      a2pApproved: true,
    };
  }

  return {
    ok: true,
    mode: "from_number",
    from: fromNumber,
    a2pApproved: approved,
  };
}

export function jwtRole(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function isServiceRoleRequest(authHeader: string): boolean {
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return bearer === serviceKey || jwtRole(bearer) === "service_role";
}
