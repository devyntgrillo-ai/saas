import { reportEdgeError } from "../_shared/report-error.ts";
// helcim-checkout, all Helcim payment operations. The API key lives ONLY here
// (Supabase secret HELCIM_API_KEY), never in the client bundle.
//
// Auth model (verify_jwt=false so unauthenticated signup can start a checkout):
//   • Public (no session): initialize_checkout (amount validated server-side),
//     create_customer, these are needed before a practice account exists.
//   • Super-admin only: get_customer, get_transaction, create_invoice, charge,
//     refund, connection_test, money movement + data lookups.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const HELCIM_API_KEY = Deno.env.get("HELCIM_API_KEY");
const HELCIM_BASE = "https://api.helcim.com/v2";
const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";

// Plan prices a client may request. Anything else falls back to 997 so a
// tampered request can't set an arbitrary charge.
const ALLOWED_AMOUNTS = [497, 597, 697, 797, 897, 997, 1497];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function helcim(endpoint: string, method = "GET", body?: object) {
  const res = await fetch(`${HELCIM_BASE}${endpoint}`, {
    method,
    headers: { "api-token": HELCIM_API_KEY!, "Content-Type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Actions any visitor may call (needed during signup, before an account exists).
const PUBLIC_ACTIONS = new Set(["initialize_checkout", "create_customer"]);

async function isSuperAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const scoped = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await scoped.auth.getUser(token);
  if (!user) return false;
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: me } = await admin.from("users").select("access_level").eq("id", user.id).maybeSingle();
  return me?.access_level === "super_admin" || (user.email || "").toLowerCase() === SUPER_ADMIN_EMAIL;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!HELCIM_API_KEY) return json({ error: "Helcim is not configured (missing HELCIM_API_KEY secret)." }, 503);

  try {
    const { action, ...params } = await req.json().catch(() => ({}));
    if (!action) return json({ error: "Missing action" }, 400);

    // Gate everything except the signup-time actions to super-admins.
    if (!PUBLIC_ACTIONS.has(action) && !(await isSuperAdmin(req))) {
      return json({ error: "Super-admin access required" }, 403);
    }

    switch (action) {
      case "initialize_checkout": {
        let amount = Number(params.amount);
        if (!ALLOWED_AMOUNTS.includes(amount)) amount = 997; // never trust a client-supplied price
        const { data } = await helcim("/helcim-pay/initialize", "POST", {
          paymentType: params.payment_type === "verify" ? "verify" : "purchase",
          amount,
          currency: "USD",
          customerCode: params.customer_code || undefined,
          invoiceNumber: params.invoice_number || undefined,
          orderNumber: params.order_number || undefined,
        });
        return json(data);
      }

      case "create_customer": {
        const email = String(params.email || "");
        const code = email.replace(/@/g, "_").replace(/\./g, "_");
        const { data } = await helcim("/customers", "POST", {
          customerCode: code,
          contactName: params.name,
          businessName: params.practice_name,
          email,
          cellPhone: params.phone,
        });
        return json(data);
      }

      case "get_customer":
        return json((await helcim(`/customers?customerCode=${encodeURIComponent(params.customer_code || "")}`)).data);

      case "create_invoice": {
        const { data } = await helcim("/invoices", "POST", {
          invoiceNumber: params.invoice_number,
          tipAmount: 0,
          depositAmount: 0,
          notes: params.notes || "CaseLift subscription",
          customerId: params.customer_id,
          currency: "USD",
          lineItems: [{ description: params.description || "CaseLift, Monthly Subscription", quantity: 1, price: params.amount, total: params.amount }],
        });
        return json(data);
      }

      case "get_transaction":
        return json((await helcim(`/card-transactions/${encodeURIComponent(params.transaction_id || "")}`)).data);

      case "refund":
        return json((await helcim(`/card-transactions/${encodeURIComponent(params.transaction_id || "")}/refund`, "POST", { amount: params.amount })).data);

      case "connection_test":
        return json((await helcim("/connection-test")).data);

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    await reportEdgeError("helcim-checkout", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
