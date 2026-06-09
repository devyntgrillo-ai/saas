// Shared role resolution for edge-function "minimum necessary" enforcement.
//
// A practice_viewer (read-only, e.g. office manager) must never receive PHI from
// the API — no transcripts, no patient contact info, no message bodies — even if
// the UI is bypassed. This is the server-side counterpart to lib/permissions.js.

import { createClient } from "@supabase/supabase-js";

interface RoleCtx {
  userId?: string;
  isServiceRole: boolean;
  client: ReturnType<typeof createClient>;
}

// Effective role of the caller:
//   'service_role'         — trusted internal call (cron / server)
//   'unknown'              — authenticated but no users row resolved (fail closed)
//   access_level || role   — e.g. 'super_admin', 'owner', 'member', 'viewer'
export async function callerRole(ctx: RoleCtx): Promise<string> {
  if (ctx.isServiceRole) return "service_role";
  if (!ctx.userId) return "unknown";
  const { data } = await ctx.client
    .from("users")
    .select("role, access_level")
    .eq("id", ctx.userId)
    .maybeSingle();
  return (data?.access_level as string) || (data?.role as string) || "unknown";
}

// Whether a role may receive PHI. Viewers are denied; an unresolved role fails
// closed; service-role and every other practice/agency role may.
export function roleCanViewPHI(role: string): boolean {
  if (role === "service_role") return true;
  return role !== "viewer" && role !== "practice_viewer" && role !== "unknown";
}

// 403 used when a viewer-tier caller requests PHI from the API.
export function phiForbidden(corsHeaders: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ error: "Your role does not have access to patient details." }),
    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
