// ============================================================================
// Chargebee API helper for Hope AI billing.
//
// Chargebee API v2 quirks this wraps:
//   - Base URL is per-site: https://{CHARGEBEE_SITE}.chargebee.com/api/v2
//   - Auth is HTTP Basic with the API key as the username and an empty password.
//   - Requests are application/x-www-form-urlencoded (NOT JSON), using bracketed
//     keys for nested objects, e.g. customer[id]=x, subscription[plan_id]=y.
//   - Responses are JSON.
//
// Secrets (server-side only):
//   CHARGEBEE_SITE     - site name, e.g. "hopeai"
//   CHARGEBEE_API_KEY  - full-access / functional API key from the dashboard
// ============================================================================

export interface ChargebeeConfig {
  site: string;
  apiKey: string;
}

// Read + validate the Chargebee config. Returns null when billing isn't
// configured so callers can return a clean 503 instead of crashing.
export function chargebeeConfig(): ChargebeeConfig | null {
  const raw = Deno.env.get("CHARGEBEE_SITE")?.trim();
  const apiKey = Deno.env.get("CHARGEBEE_API_KEY")?.trim();
  if (!raw || !apiKey) return null;
  // The base URL is rebuilt as https://{site}.chargebee.com, so we only want the
  // bare site name. Tolerate the secret being set to a full host or URL
  // ("https://dtgsaas.chargebee.com", "dtgsaas.chargebee.com") by stripping the
  // scheme, the .chargebee.com suffix, and any trailing path.
  const site = raw
    .replace(/^https?:\/\//i, "")
    .replace(/\.chargebee\.com.*$/i, "")
    .replace(/\/.*$/, "");
  if (!site) return null;
  return { site, apiKey };
}

// Flatten a nested params object into Chargebee's bracketed form-encoding.
// { customer: { id: "x" }, redirect_url: "y" } → "customer[id]=x&redirect_url=y"
// Skips null/undefined values; everything else is coerced to string.
function encodeForm(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  const walk = (prefix: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(prefix ? `${prefix}[${k}]` : k, v);
      }
    } else {
      usp.append(prefix, String(value));
    }
  };
  walk("", params);
  return usp.toString();
}

export class ChargebeeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ChargebeeError";
  }
}

// Make a Chargebee API call. `path` is relative to /api/v2 (e.g. "/customers").
// GET requests carry no body; everything else is form-encoded.
export async function chargebeeRequest(
  cfg: ChargebeeConfig,
  path: string,
  method: "GET" | "POST" = "POST",
  params: Record<string, unknown> = {},
): Promise<any> {
  const url = `https://${cfg.site}.chargebee.com/api/v2${path}`;
  const headers: Record<string, string> = {
    // Basic auth: API key as username, empty password.
    Authorization: `Basic ${btoa(`${cfg.apiKey}:`)}`,
  };
  let body: string | undefined;
  if (method !== "GET") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = encodeForm(params);
  }

  const res = await fetch(url, { method, headers, body });
  const raw = await res.text();
  if (!res.ok) {
    let detail = raw;
    try {
      const err = JSON.parse(raw);
      detail = err?.message || err?.error_msg || raw;
    } catch { /* keep raw */ }
    throw new ChargebeeError(res.status, `Chargebee ${path} ${res.status}: ${detail}`);
  }
  return raw ? JSON.parse(raw) : {};
}

// Chargebee timestamps are unix seconds. Convert to an ISO string (or null).
export const cbTimestampToIso = (sec: unknown): string | null =>
  typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : null;

// ...and to a plain YYYY-MM-DD date for the next_billing_date column.
export const cbTimestampToDate = (sec: unknown): string | null => {
  const iso = cbTimestampToIso(sec);
  return iso ? iso.slice(0, 10) : null;
};
