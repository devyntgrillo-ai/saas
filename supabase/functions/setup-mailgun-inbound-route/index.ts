// One-shot ops: ensure Mailgun inbound routes for patient reply addresses.
// Invoke with service-role bearer (reads MAILGUN_API_KEY from Edge Function secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { mailgunPatientMailRoot } from "../_shared/mailgun.ts";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const API_BASE = Deno.env.get("MAILGUN_API_BASE") || "https://api.mailgun.net/v3";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function isServiceRoleBearer(authHeader: string): boolean {
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (bearer === serviceKey) return true;
  try {
    const parts = bearer.split(".");
    if (parts.length !== 3) return false;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

type RouteRow = { id?: string; expression?: string; actions?: string[]; description?: string };
type RouteSpec = { description: string; expression: string };

async function mg(apiKey: string, path: string, { method = "GET", body }: { method?: string; body?: URLSearchParams } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return data as { items?: RouteRow[]; route?: { id?: string } };
}

function isReplyRoute(route: RouteRow): boolean {
  return String(route.expression || "").includes("reply+");
}

function routeMatches(
  route: RouteRow,
  spec: RouteSpec,
  forwardUrl: string,
): boolean {
  const actions = route.actions || [];
  return route.expression === spec.expression &&
    actions.some((a) => String(a).includes(forwardUrl)) &&
    actions.some((a) => String(a).includes("stop()"));
}

function isStaleReplyRoute(route: RouteRow, canonical: string[], forwardUrl: string): boolean {
  if (!isReplyRoute(route)) return false;
  const expr = String(route.expression || "");
  if (canonical.includes(expr)) return false;
  const actions = route.actions || [];
  const forwardsElsewhere = actions.some((a) => {
    const s = String(a);
    return s.includes("forward(") && !s.includes(forwardUrl);
  });
  return forwardsElsewhere || expr.includes("reply+");
}

async function deleteRoute(apiKey: string, route: RouteRow, checkOnly: boolean) {
  if (!route.id) return { id: route.id, expression: route.expression, status: "skipped" as const };
  if (checkOnly) {
    return { id: route.id, expression: route.expression, status: "would_delete" as const };
  }
  await mg(apiKey, `/routes/${route.id}`, { method: "DELETE" });
  return { id: route.id, expression: route.expression, status: "deleted" as const };
}

async function ensureRoute(
  apiKey: string,
  spec: RouteSpec,
  forwardUrl: string,
  existingRoutes: RouteRow[],
  checkOnly: boolean,
) {
  const existing = existingRoutes.find((r) => routeMatches(r, spec, forwardUrl));
  if (existing) {
    return { ok: true as const, status: "exists", id: existing.id, description: spec.description, expression: spec.expression };
  }

  const staleSameExpr = existingRoutes.filter(
    (r) => r.expression === spec.expression && r.id && !routeMatches(r, spec, forwardUrl),
  );
  for (const stale of staleSameExpr) {
    await deleteRoute(apiKey, stale, checkOnly);
  }

  if (checkOnly) {
    return { ok: false as const, status: "missing", description: spec.description, expression: spec.expression };
  }

  const params = new URLSearchParams();
  params.append("priority", "0");
  params.append("description", spec.description);
  params.append("expression", spec.expression);
  params.append("action", `forward("${forwardUrl}")`);
  params.append("action", "stop()");

  const created = await mg(apiKey, "/routes", { method: "POST", body: params });
  return {
    ok: true as const,
    status: "created",
    id: created.route?.id,
    description: spec.description,
    expression: spec.expression,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!isServiceRoleBearer(authHeader)) {
    return json({ error: "Unauthorized — service role bearer required" }, 401);
  }

  const apiKey = Deno.env.get("MAILGUN_API_KEY");
  if (!apiKey) return json({ error: "MAILGUN_API_KEY not configured" }, 503);

  try {
    const body = await req.json().catch(() => ({})) as { check_only?: boolean; target?: string };
    const checkOnly = body.check_only === true;
    const target = String(body.target || "mailgun-webhook").trim() || "mailgun-webhook";
    const inboundHost = (Deno.env.get("MAILGUN_INBOUND_DOMAIN") || mailgunPatientMailRoot()).trim();
    const escapedHost = inboundHost.replace(/\./g, "\\.");
    const forwardUrl = `${PROJECT_URL}/functions/v1/${target}`;

    const routes: RouteSpec[] = [
      {
        description: `CaseLift patient replies on subdomains (*.${inboundHost})`,
        expression: `match_recipient("reply+.*@.*\\.${escapedHost}")`,
      },
      {
        description: `CaseLift patient replies on root (${inboundHost}, legacy)`,
        expression: `match_recipient("reply+.*@${escapedHost}")`,
      },
    ];
    const canonicalExpressions = routes.map((r) => r.expression);

    const { items: existingRoutes = [] } = await mg(apiKey, "/routes");

    const pruned = [];
    for (const route of existingRoutes) {
      if (!isStaleReplyRoute(route, canonicalExpressions, forwardUrl)) continue;
      pruned.push(await deleteRoute(apiKey, route, checkOnly));
    }

    const results = [];
    for (const spec of routes) {
      results.push(await ensureRoute(apiKey, spec, forwardUrl, existingRoutes, checkOnly));
    }

    const allOk = results.every((r) => r.ok);
    return json({
      ok: allOk,
      check_only: checkOnly,
      inbound_host: inboundHost,
      forward_url: forwardUrl,
      pruned,
      routes: results,
      all_reply_routes: existingRoutes.filter(isReplyRoute).map((r) => ({
        id: r.id,
        expression: r.expression,
        actions: r.actions,
        description: r.description,
      })),
    }, checkOnly && !allOk ? 404 : 200);
  } catch (e) {
    console.error("setup-mailgun-inbound-route:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
});
