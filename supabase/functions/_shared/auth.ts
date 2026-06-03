// Shared JWT auth for edge functions.
// Instead of comparing raw tokens against SUPABASE_SERVICE_ROLE_KEY (which may
// be overridden by custom secrets), we decode the JWT and check its role claim.
// The function gateway has already verified the JWT signature, so we only need
// to examine the payload claims.

import { createClient } from "@supabase/supabase-js";

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
 * Decode a JWT without verifying the signature (the gateway already did that).
 * Returns the parsed payload or null.
 */
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1]));
  } catch {
    return null;
  }
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
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  // Create the admin client for DB operations in service-role mode.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!token) {
    if (required) {
      return { error: new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      })};
    }
    return { ctx: { practiceId: "", isServiceRole: true, client: admin } };
  }

  // Decode the JWT to determine the role. The gateway has already verified the
  // signature, so we trust the payload claims.
  const payload = decodeJwt(token);

  // Service-role JWTs have role === "service_role".
  if (payload?.role === "service_role") {
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
