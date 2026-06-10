// Shared JWT auth for edge functions.
// Service-role calls are verified by comparing the raw token against
// SUPABASE_SERVICE_ROLE_KEY. User JWT calls are validated against GoTrue.

import { createClient } from "@supabase/supabase-js";
import { isServiceRoleJwt, serviceRoleClient } from "./service-role.ts";

export interface AuthContext {
  /** The authenticated user (undefined for service-role calls). */
  userId?: string;
  /** Resolved practice_id. */
  practiceId: string;
  /** true when the caller is using the service-role key. */
  isServiceRole: boolean;
  /** Supabase client scoped to the caller. */
  client: ReturnType<typeof createClient>;
}

/**
 * Resolve the auth context from a request.
 *
 * @param req           The incoming edge function request.
 * @param body          Parsed request body (must contain practice_id for service-role calls).
 * @param required      When true (default), returns 401/403 for unauthenticated requests.
 * @returns AuthContext with practiceId, client, and user info.
 */
export async function resolveAuth(
  req: Request,
  body: Record<string, unknown>,
  required = true,
): Promise<{ ctx?: AuthContext; error?: Response }> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  const admin = serviceRoleClient(req);

  if (!token) {
    if (required) {
      return { error: new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      })};
    }
    return { ctx: { practiceId: "", isServiceRole: true, client: admin } };
  }

  if (isServiceRoleJwt(token)) {
    const practiceId = (body.practice_id as string) ?? "";
    if (!practiceId && required) {
      return { error: new Response(JSON.stringify({ error: "practice_id required for service calls" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      })};
    }
    return {
      ctx: { practiceId, isServiceRole: true, client: admin, userId: undefined },
    };
  }

  // User JWT path: validate against GoTrue.
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      throw userErr || new Error("No user");
    }

    const { data: profile } = await userClient
      .from("users")
      .select("practice_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.practice_id) {
      return { error: new Response(JSON.stringify({ error: "Your account is not linked to a practice." }), {
        status: 403, headers: { "Content-Type": "application/json" },
      })};
    }

    return {
      ctx: {
        userId: user.id,
        practiceId: profile.practice_id,
        isServiceRole: false,
        client: userClient,
      },
    };
  } catch {
    if (required) {
      return { error: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      })};
    }
    return { error: new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    })};
  }
}

/**
 * Quick guard for internal cron jobs: verifies the request carries a valid
 * service_role JWT by comparing the raw token against the actual
 * SUPABASE_SERVICE_ROLE_KEY. This avoids trusting the gateway alone.
 *
 * Returns an error Response when unauthorized, or undefined to continue.
 */
/** True when Authorization carries the service-role key (cron / internal calls). */
export function isServiceRoleBearer(authHeader: string): boolean {
  return isServiceRoleJwt(authHeader.replace(/^Bearer\s+/i, "").trim());
}

export type PracticeAccessResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Impersonation-aware practice gate for edge functions (mailgun-send, twilio-send).
 * Service-role callers are trusted. User JWT callers must pass RLS on practices
 * (own practice, multi-location member, agency reseller, or super-admin).
 */
export async function checkPracticeAccess(
  req: Request,
  practiceId: string,
): Promise<PracticeAccessResult> {
  const authHeader = req.headers.get("Authorization") || "";
  if (isServiceRoleBearer(authHeader)) return { ok: true };
  if (!authHeader) return { ok: false, status: 401, error: "Unauthorized" };

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: practice } = await userClient
    .from("practices")
    .select("id")
    .eq("id", practiceId)
    .maybeSingle();
  if (!practice?.id) return { ok: false, status: 403, error: "Forbidden" };

  return { ok: true };
}

export function requireServiceRole(req: Request): Response | undefined {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!isServiceRoleJwt(token)) {
    return new Response(JSON.stringify({ error: "Forbidden: service_role required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return undefined;
}
