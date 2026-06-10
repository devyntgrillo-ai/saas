/**
 * Service-role helpers for cron + internal edge-function calls.
 *
 * Hosted projects may have a custom SUPABASE_SERVICE_ROLE_KEY secret that drifts
 * from the live API key (e.g. after key rotation). Cron jobs pass the current JWT
 * in Authorization; use that token for Supabase clients and downstream invokes
 * instead of relying on Deno.env alone.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function extractBearer(authHeader: string): string {
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

export function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** True for any valid service_role JWT (ignores env secret drift). */
export function isServiceRoleJwt(token: string): boolean {
  if (!token) return false;
  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (envKey && token === envKey) return true;
  return jwtPayload(token)?.role === "service_role";
}

export function isServiceRoleRequest(req: Request): boolean {
  const bearer = extractBearer(req.headers.get("Authorization") || "");
  return isServiceRoleJwt(bearer);
}

/** Prefer the caller's service_role JWT; fall back to env for local/dev. */
export function serviceRoleClient(req?: Request): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const bearer = req ? extractBearer(req.headers.get("Authorization") || "") : "";
  const key = isServiceRoleJwt(bearer)
    ? bearer
    : (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function authorizationHeader(req?: Request): string {
  const bearer = req ? extractBearer(req.headers.get("Authorization") || "") : "";
  if (isServiceRoleJwt(bearer)) return `Bearer ${bearer}`;
  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return envKey ? `Bearer ${envKey}` : "";
}

/** HTTP invoke with explicit Authorization + apikey (avoids stale functions.invoke client). */
export async function invokeEdgeFunction(
  functionName: string,
  body: Record<string, unknown>,
  req?: Request,
): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL")!;
  const auth = authorizationHeader(req);
  const apikey = extractBearer(auth);
  const res = await fetch(`${base}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: auth,
      apikey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || `invoke ${functionName} failed (${res.status})`);
  }
}
