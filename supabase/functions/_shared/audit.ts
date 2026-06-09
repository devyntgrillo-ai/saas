// ============================================================================
// Server-side audit logging for edge functions.
//
// This is the AUTHORITATIVE PHI-access trail: it runs where the user cannot
// bypass it and where the real client IP / user-agent are available. Writes go
// through the service-role client (bypasses RLS), so callers must pass the
// admin client they already created via _shared/auth.ts.
//
// Never throws — an audit failure must not break the request it accompanies.
//
// Do NOT log raw PHI in `details`: identifiers and metadata only.
// ============================================================================
import { createClient } from "@supabase/supabase-js";

type AdminClient = ReturnType<typeof createClient>;

export interface AuditFields {
  action: string;
  userId?: string | null;
  userEmail?: string | null;
  practiceId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  phiAccessed?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Pull the client IP + user-agent off the incoming request headers. */
export function clientMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  return { ipAddress: ip, userAgent: req.headers.get("user-agent") || null };
}

/**
 * Write one audit row via the service-role client. Best-effort; logs to console
 * on failure but never throws.
 */
export async function recordAudit(admin: AdminClient, f: AuditFields): Promise<void> {
  try {
    const { error } = await admin.from("audit_logs").insert({
      action: f.action,
      user_id: f.userId ?? null,
      user_email: f.userEmail ?? null,
      practice_id: f.practiceId ?? null,
      resource_type: f.resourceType ?? null,
      resource_id: f.resourceId != null ? String(f.resourceId) : null,
      details: f.details ?? null,
      phi_accessed: f.phiAccessed ?? false,
      ip_address: f.ipAddress ?? null,
      user_agent: f.userAgent ?? null,
    });
    if (error) console.warn("[audit] recordAudit failed:", error.message);
  } catch (e) {
    console.warn("[audit] recordAudit threw:", e);
  }
}

/** Convenience: record an audit row, deriving IP/UA from the request. */
export async function recordAuditFromReq(
  admin: AdminClient,
  req: Request,
  f: AuditFields,
): Promise<void> {
  const { ipAddress, userAgent } = clientMeta(req);
  await recordAudit(admin, { ipAddress, userAgent, ...f });
}
