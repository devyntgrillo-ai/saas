// ============================================================================
// Shared Sikka OAuth 2.0 helper for the edge functions.
//
// Auth model (per the integration spec + Sikka developer portal):
//   1. The practice clicks "Connect to Sikka" → we send them to Sikka's portal
//      authorize page (response_type=code). They click Allow.
//   2. Sikka redirects back to our callback with ?code=...  We exchange the code
//      at POST /token (grant_type=authorization_code) for a `request_key`
//      (valid ~24h) + a `refresh_token`.
//   3. Each practice stores its own request_key / refresh_token / expiry. Before
//      any data call we refresh (grant_type=refresh_token) if expired.
//
// There is NO platform-wide SIKKA_API_KEY anymore - only the app credentials
// SIKKA_APP_ID (application_id) and SIKKA_APP_SECRET (application_secret_key).
//
// Endpoint versions: confirmed against Sikka's knowledge base + API portal -
// the API is v4 (GET /v4/appointments; request_key passed as a `Request-Key`
// header, tied to office_id). Base + paths stay env-overridable in case the
// account is provisioned differently. The OAuth token endpoint URL is the one
// piece not fully confirmed, so it has its own full-URL override (SIKKA_TOKEN_URL).
// ============================================================================

// Base, e.g. https://api.sikkasoft.com/v4  (no trailing slash)
export const SIKKA_BASE = (Deno.env.get("SIKKA_BASE_URL") || "https://api.sikkasoft.com/v4").replace(/\/$/, "");
// Authorize page the practice is redirected to (portal, not the API base).
export const SIKKA_AUTHORIZE_URL = Deno.env.get("SIKKA_AUTHORIZE_URL") || "https://api.sikkasoft.com/portal/authapp.aspx";
// Resource paths (relative to SIKKA_BASE) - overridable.
export const SIKKA_APPOINTMENTS_PATH = Deno.env.get("SIKKA_APPOINTMENTS_PATH") || "/appointments";
export const SIKKA_AUTHORIZED_PRACTICES_PATH = Deno.env.get("SIKKA_AUTHORIZED_PRACTICES_PATH") || "/authorized_practices";
// Full OAuth token endpoint URL. Defaults to {base}/token but is independently
// overridable since the token endpoint may live off the versioned API base.
export const SIKKA_TOKEN_URL = Deno.env.get("SIKKA_TOKEN_URL") || `${SIKKA_BASE}${Deno.env.get("SIKKA_TOKEN_PATH") || "/token"}`;

// Refresh this many ms before the stored expiry so an in-flight call never races
// the boundary.
const EXPIRY_SKEW_MS = 60_000;

export interface SikkaTokens {
  request_key: string;
  refresh_token: string | null;
  expires_at: string; // ISO timestamp
}

export function getAppCreds(): { id: string; secret: string } {
  const id = Deno.env.get("SIKKA_APP_ID");
  const secret = Deno.env.get("SIKKA_APP_SECRET");
  if (!id || !secret) throw new Error("sikka_app_not_configured");
  return { id, secret };
}

// The OAuth redirect_uri must be identical in the authorize request, the token
// exchange, AND what is registered in the Sikka developer portal. Defaults to
// this function's own URL; override with SIKKA_REDIRECT_URI if registered
// differently.
export function redirectUri(): string {
  const explicit = Deno.env.get("SIKKA_REDIRECT_URI");
  if (explicit) return explicit;
  // Falls back to this project's callback URL if SUPABASE_URL isn't present.
  const base = (Deno.env.get("SUPABASE_URL") || "https://eymgqjeudrmeofytnwgs.supabase.co").replace(/\/$/, "");
  return `${base}/functions/v1/sikka-oauth-callback`;
}

// Where the user lands back in the SPA after the callback finishes.
export function appUrl(): string {
  return (Deno.env.get("APP_URL") || "https://app.caselift.io").replace(/\/$/, "");
}

// Build the portal authorize URL the practice is sent to. `state` carries the
// practice_id so the callback knows whose tokens to save.
export function buildAuthorizeUrl(state: string): string {
  const { id } = getAppCreds();
  const q = new URLSearchParams({
    response_type: "code",
    client_id: id,
    redirect_uri: redirectUri(),
    scope: "*",
    state,
  });
  return `${SIKKA_AUTHORIZE_URL}?${q.toString()}`;
}

// Normalize a Sikka token response into our DB shape. Sikka returns expiry as
// `expires_in` (seconds) on some responses; fall back to the documented 24h.
// deno-lint-ignore no-explicit-any
function toTokens(data: any): SikkaTokens {
  const requestKey = data?.request_key ?? data?.access_token ?? data?.requestKey;
  if (!requestKey) throw new Error(`sikka_token_missing_request_key: ${JSON.stringify(data).slice(0, 200)}`);
  const seconds = Number(data?.expires_in);
  const ttlMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 24 * 60 * 60 * 1000;
  return {
    request_key: String(requestKey),
    refresh_token: data?.refresh_token ?? data?.refreshToken ?? data?.refresh_key ?? null,
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
  };
}

// POST to the token endpoint (application/x-www-form-urlencoded, standard OAuth).
// Sends both the OAuth-standard client_id/client_secret AND Sikka's app_id/app_key
// aliases so the exchange works regardless of which the token endpoint expects.
async function postToken(params: Record<string, string>): Promise<SikkaTokens> {
  const { id, secret } = getAppCreds();
  const body = new URLSearchParams({
    client_id: id, client_secret: secret,
    app_id: id, app_key: secret,
    ...params,
  });
  const res = await fetch(SIKKA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`sikka_token_${res.status}: ${text.slice(0, 300)}`);
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error(`sikka_token_parse: ${text.slice(0, 200)}`); }
  return toTokens(data);
}

// Step 2: exchange the authorization code from the portal redirect.
export function exchangeAuthCode(code: string): Promise<SikkaTokens> {
  return postToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
}

// Renew an expired request_key with the stored refresh_token (OAuth flow).
export function refreshAccessToken(refreshToken: string): Promise<SikkaTokens> {
  return postToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

// Renew via Sikka's request_key endpoint (grant_type=refresh_key). This is the
// model used when a practice is linked with office_id + refresh_key (sandbox /
// manual link), not the OAuth /token endpoint.
export async function refreshRequestKey(officeId: string, refreshKey: string): Promise<SikkaTokens> {
  const { id, secret } = getAppCreds();
  const path = Deno.env.get("SIKKA_REQUEST_KEY_PATH") || "/request_key";
  const res = await fetch(`${SIKKA_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_key",
      refresh_key: refreshKey,
      app_id: id,
      app_key: secret,
      office_id: officeId,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`sikka_refresh_key_${res.status}: ${text.slice(0, 300)}`);
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error(`sikka_refresh_key_parse: ${text.slice(0, 200)}`); }
  return toTokens(data);
}

export interface SikkaPracticeRow {
  id: string;
  email?: string | null;
  sikka_practice_id: string | null;
  sikka_request_key: string | null;
  sikka_refresh_token: string | null;
  sikka_token_expires_at: string | null;
}

// Persist a fresh token set onto the practice row.
// deno-lint-ignore no-explicit-any
export async function saveTokens(admin: any, practiceId: string, t: SikkaTokens, extra: Record<string, unknown> = {}) {
  await admin.from("practices").update({
    sikka_request_key: t.request_key,
    sikka_refresh_token: t.refresh_token,
    sikka_token_expires_at: t.expires_at,
    ...extra,
  }).eq("id", practiceId);
}

// Return a valid request_key for the practice, refreshing + persisting if the
// stored one is missing/expired. Throws `sikka_not_connected` if the practice
// has never completed the OAuth flow.
// deno-lint-ignore no-explicit-any
export async function ensureFreshToken(admin: any, practice: SikkaPracticeRow): Promise<string> {
  const exp = practice.sikka_token_expires_at ? new Date(practice.sikka_token_expires_at).getTime() : 0;
  if (practice.sikka_request_key && exp - EXPIRY_SKEW_MS > Date.now()) {
    return practice.sikka_request_key;
  }
  if (!practice.sikka_refresh_token) throw new Error("sikka_not_connected");
  let refreshed: SikkaTokens;
  if (practice.sikka_practice_id) {
    try {
      refreshed = await refreshRequestKey(practice.sikka_practice_id, practice.sikka_refresh_token);
    } catch (e) {
      console.warn("Sikka refresh_key failed, trying OAuth refresh_token:", (e as Error)?.message);
      refreshed = await refreshAccessToken(practice.sikka_refresh_token);
    }
  } else {
    refreshed = await refreshAccessToken(practice.sikka_refresh_token);
  }
  await saveTokens(admin, practice.id, refreshed, { sikka_connected: true });
  return refreshed.request_key;
}

// Authenticated GET against a Sikka resource. v4 expects the request_key in a
// `Request-Key` header; we also include it as a query param as a harmless
// fallback. office_id + any date range go in `params`.
// deno-lint-ignore no-explicit-any
export async function sikkaGet(path: string, requestKey: string, params: Record<string, string> = {}): Promise<any> {
  const q = new URLSearchParams({ request_key: requestKey, ...params });
  const res = await fetch(`${SIKKA_BASE}${path}?${q.toString()}`, {
    headers: { Accept: "application/json", "Request-Key": requestKey },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`sikka_${res.status}: ${text.slice(0, 300)}`);
  // Sikka returns 204 with an empty body when a date range has no rows.
  if (res.status === 204 || !text.trim()) return [];
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`sikka_parse: ${text.slice(0, 200)}`);
  }
}

// Tolerate the list-wrapping shapes Sikka returns. v4 wraps results as
// { summary, data: { items: [...], startdate, enddate } }, so check the nested
// data.items envelope in addition to caller-named keys + flat shapes.
// deno-lint-ignore no-explicit-any
export function unwrapList(data: any, ...keys: string[]): any[] {
  if (Array.isArray(data)) return data;
  for (const k of keys) if (Array.isArray(data?.[k])) return data[k];
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data?.items)) return data.data.items; // v4 envelope
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

// ---- Treatment-type + value mapping ----------------------------------------
// Mirrors src/lib/treatments.js normalizeTreatment so PMS appointment/treatment
// descriptions map to the same CaseLift treatment_type values the app uses.
const KNOWN_TREATMENTS = new Set([
  "dental_implants", "full_arch", "invisalign", "cosmetic_veneers",
  "sleep_apnea", "periodontal", "full_mouth_rehab", "other",
]);

export function normalizeTreatment(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (KNOWN_TREATMENTS.has(s)) return s;
  if (/all.?on.?4|all.?on.?x|full.?arch/.test(s)) return "full_arch";
  if (/implant/.test(s)) return "dental_implants";
  if (/invisalign|aligner|ortho/.test(s)) return "invisalign";
  if (/veneer|cosmetic|smile/.test(s)) return "cosmetic_veneers";
  if (/sleep|apnea|cpap|appliance/.test(s)) return "sleep_apnea";
  if (/perio|gum|scaling|srp/.test(s)) return "periodontal";
  if (/full.?mouth|rehab|reconstruction/.test(s)) return "full_mouth_rehab";
  return null;
}

// Best-effort treatment-plan value from a Sikka payload across its many shapes
// (appointment, treatment_plan, or transaction-like records). Positive number or null.
// deno-lint-ignore no-explicit-any
export function pickTxValue(o: any): number | null {
  if (!o) return null;
  const raw = o.treatment_plan_amount ?? o.treatment_value ?? o.tx_plan_value ??
    o.estimated_value ?? o.estimate ?? o.total ?? o.production ??
    o.amount ?? o.case_value ?? o.treatment_amount ?? o.fee;
  const v = Number(typeof raw === "string" ? raw.replace(/[^0-9.]/g, "") : raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}
