// Helpers for the Sikka registration queue (webhook store → practice claim).

// deno-lint-ignore no-explicit-any
const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] != null && o[k] !== "") return o[k];
  return null;
};

export function normalizeSikkaOfficeId(input: unknown): string | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  return s.toUpperCase();
}

export interface RegistrationPreview {
  id: string;
  sikka_practice_id: string;
  practice_name: string | null;
  npi: string | null;
  pms_type: string | null;
  address: string | null;
  created_at: string;
}

// deno-lint-ignore no-explicit-any
export function registrationPreview(row: any): RegistrationPreview {
  const raw = (row.raw || {}) as Record<string, unknown>;
  const addressParts = [
    pick(raw, "address", "street"),
    pick(raw, "city"),
    pick(raw, "state"),
    pick(raw, "zip", "zipcode"),
  ].filter(Boolean);
  return {
    id: row.id,
    sikka_practice_id: row.sikka_practice_id,
    practice_name: row.practice_name ?? str(pick(raw, "practice_name", "name", "office_name")),
    npi: row.npi ?? str(raw.npi),
    pms_type: str(pick(raw, "pms_type", "practice_management_system", "software", "pms", "pms_name")),
    address: addressParts.length ? addressParts.join(", ") : null,
    created_at: row.created_at,
  };
}

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v).trim() || null;
}

/** Pull OAuth / request_key tokens from a Sikka registration payload when present. */
// deno-lint-ignore no-explicit-any
export function tokensFromRegistrationRaw(raw: unknown): {
  request_key: string | null;
  refresh_token: string | null;
  expires_at: string | null;
} {
  const r = (raw || {}) as Record<string, unknown>;
  const requestKey = str(pick(r, "request_key", "requestKey", "access_token"));
  const refresh = str(pick(r, "refresh_key", "refresh_token", "refreshToken"));
  const expiresIn = Number(r.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return { request_key: requestKey, refresh_token: refresh, expires_at: expiresAt };
}

/** Sikka practice_id within an office (usually "1" for single-location). */
export function practiceIdFromRegistrationRaw(raw: unknown): string {
  const r = (raw || {}) as Record<string, unknown>;
  const id = str(pick(r, "practice_id", "sikka_practice_location_id"));
  return id || "1";
}
