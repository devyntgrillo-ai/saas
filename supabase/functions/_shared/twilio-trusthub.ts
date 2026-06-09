/**
 * Twilio Trust Hub ISV flow for A2P 10DLC (Secondary Customer Profile + TrustProduct).
 * @see https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api
 */
import type { TwilioConfig } from "./twilio.ts";
import { toE164 } from "./twilio.ts";
import { twilioRequest } from "./twilio-api.ts";

/** Business + contact fields collected in Phone Setup wizard. */
export interface A2PBusiness {
  legal_name?: string;
  business_type?: string;
  ein?: string;
  website?: string;
  contact_first?: string;
  contact_last?: string;
  contact_email?: string;
  contact_phone?: string;
  use_case?: string;
  message_samples?: string[];
  opt_in_description?: string;
  address_street?: string;
  address_city?: string;
  address_region?: string;
  address_postal?: string;
}

export interface TrustHubStored {
  customer_profile_sid?: string;
  trust_product_sid?: string;
}

export type A2pBundleResult =
  | { ok: true; customerProfileBundleSid: string; a2pProfileBundleSid: string; trustHub: TrustHubStored }
  | { ok: false; reason: string };

const CUSTOMER_PROFILE_POLICY = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const A2P_TRUST_PRODUCT_POLICY = "RNb0d4771c2c98518d916a3d4cd70a8f8b";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Twilio asks ISVs to rate-limit registration APIs (~1 req/s). */
async function throttle(): Promise<void> {
  await sleep(1100);
}

function trustHubEmail(): string | null {
  return Deno.env.get("TWILIO_TRUSTHUB_NOTIFICATION_EMAIL") ||
    Deno.env.get("HOPE_PLATFORM_EMAIL") ||
    null;
}

function primaryCustomerProfileSid(): string | null {
  return Deno.env.get("TWILIO_PRIMARY_CUSTOMER_PROFILE_SID") ||
    Deno.env.get("TWILIO_PRIMARY_BUSINESS_PROFILE_SID") ||
    null;
}

/** Pre-created bundle SIDs (skip Trust Hub API when both are set). */
export function preconfiguredA2pBundles(): { customer: string; a2p: string } | null {
  const customer = Deno.env.get("TWILIO_CUSTOMER_PROFILE_BUNDLE_SID") ||
    null;
  const a2p = Deno.env.get("TWILIO_A2P_PROFILE_BUNDLE_SID") || null;
  if (customer && a2p) return { customer, a2p };
  return null;
}

/** ISV primary BU must not be stored as the practice secondary customer profile. */
export function sanitizeTrustHubStored(existing: TrustHubStored = {}): TrustHubStored {
  const primarySid = primaryCustomerProfileSid();
  const out: TrustHubStored = { ...existing };
  if (primarySid && out.customer_profile_sid === primarySid) {
    delete out.customer_profile_sid;
    delete out.trust_product_sid;
  }
  return out;
}

/** After a failed brand/campaign, recreate trust product + brand; keep a valid secondary profile. */
export function trustHubForResubmit(
  existing: TrustHubStored,
  brandStatus: string | null | undefined,
  campaignStatus: string | null | undefined,
  brandCriticalChanged = false,
): TrustHubStored {
  const th = sanitizeTrustHubStored(existing);
  if (brandStatus === "failed" || campaignStatus === "failed" || brandCriticalChanged) {
    delete th.trust_product_sid;
  }
  return th;
}

/** Brand-level fields that require Trust Hub refresh + new brand registration when changed. */
export function brandCriticalFieldsChanged(prev: A2PBusiness, next: A2PBusiness): boolean {
  const norm = (v: string | undefined) => String(v || "").trim().toLowerCase().replace(/\/$/, "");
  return norm(prev.website) !== norm(next.website) ||
    norm(prev.legal_name) !== norm(next.legal_name) ||
    String(prev.ein || "").replace(/\D/g, "") !== String(next.ein || "").replace(/\D/g, "");
}

/** Assign an updated business end user (e.g. corrected website) to an existing customer profile. */
export async function refreshTrustHubBusinessInfo(
  cfg: TwilioConfig,
  customerProfileSid: string,
  biz: A2PBusiness,
  practiceName: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!biz.legal_name?.trim() || !biz.ein?.trim()) {
    return { ok: false, reason: "Legal name and EIN are required to update brand business info." };
  }
  const label = (practiceName || biz.legal_name || "Practice").slice(0, 40);
  try {
    const businessEndUser = await createEndUser(
      cfg,
      `${label} Business Info`,
      "customer_profile_business_information",
      {
        business_name: biz.legal_name!.trim(),
        website_url: (biz.website || "https://example.com").trim(),
        business_regions_of_operation: "USA_AND_CANADA",
        business_type: mapTwilioBusinessType(biz.business_type || ""),
        business_registration_identifier: "EIN",
        business_identity: "direct_customer",
        business_industry: "HEALTHCARE",
        business_registration_number: biz.ein!.replace(/\D/g, "").slice(0, 21),
      },
    );
    await assignToCustomerProfile(cfg, customerProfileSid, businessEndUser);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e as Error).message ?? e) };
  }
}

function mapTwilioBusinessType(raw: string): string {
  const s = String(raw || "").toLowerCase();
  if (s.includes("sole")) return "Sole Proprietorship";
  if (s.includes("llc")) return "Limited Liability Corporation";
  if (s.includes("corp")) return "Corporation";
  if (s.includes("non")) return "Non-profit Corporation";
  if (s.includes("partnership")) return "Partnership";
  return "Limited Liability Corporation";
}

function mapCompanyType(raw: string): string {
  const s = String(raw || "").toLowerCase();
  if (s.includes("non")) return "non_profit";
  if (s.includes("gov")) return "government";
  return "private";
}

function parseAddress(biz: A2PBusiness, practiceAddress?: string | null) {
  const street = (biz.address_street || practiceAddress || "").trim();
  const city = (biz.address_city || "").trim();
  const region = (biz.address_region || "").trim();
  const postal = (biz.address_postal || "").trim();
  if (!street || !city || !region || !postal) {
    return null;
  }
  return { street, city, region, postal };
}

async function createEndUser(
  cfg: TwilioConfig,
  friendlyName: string,
  type: string,
  attributes: Record<string, string>,
): Promise<string> {
  const form = new URLSearchParams();
  form.set("FriendlyName", friendlyName.slice(0, 64));
  form.set("Type", type);
  form.set("Attributes", JSON.stringify(attributes));
  const res = await twilioRequest<{ sid: string }>(cfg, "trusthub", "/EndUsers", {
    method: "POST",
    body: form.toString(),
  });
  await throttle();
  return res.sid;
}

async function assignToCustomerProfile(
  cfg: TwilioConfig,
  customerProfileSid: string,
  objectSid: string,
): Promise<void> {
  const form = new URLSearchParams();
  form.set("ObjectSid", objectSid);
  await twilioRequest(cfg, "trusthub", `/CustomerProfiles/${customerProfileSid}/EntityAssignments`, {
    method: "POST",
    body: form.toString(),
  });
  await throttle();
}

async function assignToTrustProduct(
  cfg: TwilioConfig,
  trustProductSid: string,
  objectSid: string,
): Promise<void> {
  const form = new URLSearchParams();
  form.set("ObjectSid", objectSid);
  await twilioRequest(cfg, "trusthub", `/TrustProducts/${trustProductSid}/EntityAssignments`, {
    method: "POST",
    body: form.toString(),
  });
  await throttle();
}

/**
 * Run Trust Hub steps 1–2 for a practice; returns bundle SIDs for BrandRegistration.
 */
export async function ensureA2pTrustHubBundles(
  cfg: TwilioConfig,
  practiceId: string,
  practiceName: string,
  biz: A2PBusiness,
  practiceAddress: string | null,
  existingIn: TrustHubStored = {},
): Promise<A2pBundleResult> {
  const preconfig = preconfiguredA2pBundles();
  if (preconfig) {
    return {
      ok: true,
      customerProfileBundleSid: preconfig.customer,
      a2pProfileBundleSid: preconfig.a2p,
      trustHub: sanitizeTrustHubStored(existingIn),
    };
  }

  const primarySid = primaryCustomerProfileSid();
  const existing = sanitizeTrustHubStored(existingIn);

  const customerIsSecondary = !!existing.customer_profile_sid &&
    (!primarySid || existing.customer_profile_sid !== primarySid);
  if (customerIsSecondary && existing.trust_product_sid) {
    return {
      ok: true,
      customerProfileBundleSid: existing.customer_profile_sid,
      a2pProfileBundleSid: existing.trust_product_sid,
      trustHub: existing,
    };
  }

  const notifyEmail = trustHubEmail();
  if (!notifyEmail) {
    return {
      ok: false,
      reason: "Set TWILIO_TRUSTHUB_NOTIFICATION_EMAIL (ISV inbox for Trust Hub status updates).",
    };
  }
  if (!primarySid) {
    return {
      ok: false,
      reason: "Set TWILIO_PRIMARY_CUSTOMER_PROFILE_SID (approved Primary Business Profile BU… from Trust Hub).",
    };
  }

  const addr = parseAddress(biz, practiceAddress);
  if (!addr) {
    return {
      ok: false,
      reason: "Complete practice address (street, city, state, ZIP) in Settings or the A2P wizard before registering.",
    };
  }

  if (!biz.legal_name?.trim() || !biz.ein?.trim() || !biz.contact_email?.trim()) {
    return { ok: false, reason: "Legal name, EIN, and contact email are required for A2P registration." };
  }

  const customerPolicy = Deno.env.get("TWILIO_TRUSTHUB_CUSTOMER_PROFILE_POLICY_SID") ||
    CUSTOMER_PROFILE_POLICY;
  const trustProductPolicy = Deno.env.get("TWILIO_TRUSTHUB_A2P_TRUST_PRODUCT_POLICY_SID") ||
    A2P_TRUST_PRODUCT_POLICY;

  const label = (practiceName || biz.legal_name || "Practice").slice(0, 40);
  const trustHub: TrustHubStored = { ...existing };

  try {
    // --- Step 1: Secondary Customer Profile ---
    let customerProfileSid = trustHub.customer_profile_sid;
    if (!customerProfileSid) {
      const cpForm = new URLSearchParams();
      cpForm.set("FriendlyName", `Hope AI - ${label} Customer Profile`.slice(0, 64));
      cpForm.set("Email", notifyEmail);
      cpForm.set("PolicySid", customerPolicy);
      const cp = await twilioRequest<{ sid: string }>(cfg, "trusthub", "/CustomerProfiles", {
        method: "POST",
        body: cpForm.toString(),
      });
      customerProfileSid = cp.sid;
      trustHub.customer_profile_sid = customerProfileSid;
      await throttle();
    }

    const businessEndUser = await createEndUser(
      cfg,
      `${label} Business Info`,
      "customer_profile_business_information",
      {
        business_name: biz.legal_name!.trim(),
        website_url: (biz.website || "https://example.com").trim(),
        business_regions_of_operation: "USA_AND_CANADA",
        business_type: mapTwilioBusinessType(biz.business_type || ""),
        business_registration_identifier: "EIN",
        business_identity: "direct_customer",
        business_industry: "HEALTHCARE",
        business_registration_number: biz.ein!.replace(/\D/g, "").slice(0, 21),
      },
    );
    await assignToCustomerProfile(cfg, customerProfileSid, businessEndUser);

    const contactPhone = toE164(biz.contact_phone || "") || "+10000000000";
    const authRepEndUser = await createEndUser(
      cfg,
      `${label} Authorized Rep`,
      "authorized_representative_1",
      {
        first_name: (biz.contact_first || "Authorized").trim(),
        last_name: (biz.contact_last || "Representative").trim(),
        email: biz.contact_email!.trim(),
        phone_number: contactPhone,
        job_position: "Director",
        business_title: "Owner",
      },
    );
    await assignToCustomerProfile(cfg, customerProfileSid, authRepEndUser);

    const addressForm = new URLSearchParams();
    addressForm.set("FriendlyName", `${label} Address`.slice(0, 64));
    addressForm.set("CustomerName", biz.legal_name!.trim());
    addressForm.set("Street", addr.street);
    addressForm.set("City", addr.city);
    addressForm.set("Region", addr.region);
    addressForm.set("PostalCode", addr.postal);
    addressForm.set("IsoCountry", "US");
    const address = await twilioRequest<{ sid: string }>(
      cfg,
      "api",
      `/Accounts/${cfg.accountSid}/Addresses.json`,
      { method: "POST", body: addressForm.toString() },
    );
    await throttle();

    const docForm = new URLSearchParams();
    docForm.set("FriendlyName", `${label} Address Doc`.slice(0, 64));
    docForm.set("Type", "customer_profile_address");
    docForm.set("Attributes", JSON.stringify({ address_sids: address.sid }));
    const supportingDoc = await twilioRequest<{ sid: string }>(cfg, "trusthub", "/SupportingDocuments", {
      method: "POST",
      body: docForm.toString(),
    });
    await throttle();
    await assignToCustomerProfile(cfg, customerProfileSid, supportingDoc.sid);

    await assignToCustomerProfile(cfg, customerProfileSid, primarySid);

    try {
      const evalForm = new URLSearchParams();
      evalForm.set("PolicySid", customerPolicy);
      await twilioRequest(
        cfg,
        "trusthub",
        `/CustomerProfiles/${customerProfileSid}/Evaluations`,
        { method: "POST", body: evalForm.toString() },
      );
      await throttle();
    } catch (e) {
      console.warn("Customer profile evaluation:", (e as Error).message);
    }

    const submitCp = new URLSearchParams();
    submitCp.set("Status", "pending-review");
    await twilioRequest(cfg, "trusthub", `/CustomerProfiles/${customerProfileSid}`, {
      method: "POST",
      body: submitCp.toString(),
    });
    await throttle();

    // --- Step 2: A2P TrustProduct ---
    let trustProductSid = trustHub.trust_product_sid;
    if (!trustProductSid) {
      const tpForm = new URLSearchParams();
      tpForm.set("FriendlyName", `Hope AI - ${label} A2P Trust`.slice(0, 64));
      tpForm.set("Email", notifyEmail);
      tpForm.set("PolicySid", trustProductPolicy);
      const tp = await twilioRequest<{ sid: string }>(cfg, "trusthub", "/TrustProducts", {
        method: "POST",
        body: tpForm.toString(),
      });
      trustProductSid = tp.sid;
      trustHub.trust_product_sid = trustProductSid;
      await throttle();
    }

    const a2pAttrs: Record<string, string> = {
      company_type: mapCompanyType(biz.business_type || ""),
      brand_contact_email: biz.contact_email!.trim(),
    };
    const a2pEndUser = await createEndUser(
      cfg,
      `${label} A2P Profile`,
      "us_a2p_messaging_profile_information",
      a2pAttrs,
    );
    await assignToTrustProduct(cfg, trustProductSid, a2pEndUser);
    await assignToTrustProduct(cfg, trustProductSid, customerProfileSid);

    try {
      const tpEval = new URLSearchParams();
      tpEval.set("PolicySid", trustProductPolicy);
      await twilioRequest(cfg, "trusthub", `/TrustProducts/${trustProductSid}/Evaluations`, {
        method: "POST",
        body: tpEval.toString(),
      });
      await throttle();
    } catch (e) {
      console.warn("Trust product evaluation:", (e as Error).message);
    }

    const submitTp = new URLSearchParams();
    submitTp.set("Status", "pending-review");
    await twilioRequest(cfg, "trusthub", `/TrustProducts/${trustProductSid}`, {
      method: "POST",
      body: submitTp.toString(),
    });
    await throttle();

    return {
      ok: true,
      customerProfileBundleSid: customerProfileSid,
      a2pProfileBundleSid: trustProductSid,
      trustHub,
    };
  } catch (e) {
    return { ok: false, reason: String((e as Error).message ?? e) };
  }
}
