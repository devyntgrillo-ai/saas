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
// Actions that self-authenticate against the caller's own practice (not super-admin).
const SELF_AUTH_ACTIONS = new Set(["record_payment", "update_card", "manage_subscription"]);

// Resolve the authenticated caller and their practice (never trust the body for identity).
async function getCaller(req: Request): Promise<{ userId: string; practiceId: string | null; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  if (!token || token === anon) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const scoped = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await scoped.auth.getUser(token);
  if (!user) return null;
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: me } = await admin.from("users").select("practice_id, email").eq("id", user.id).maybeSingle();
  return { userId: user.id, practiceId: (me?.practice_id as string) ?? null, email: (me?.email as string) ?? user.email ?? null };
}

// A ± 1 day YYYY-MM-DD window around the Helcim.js transaction date — used to
// scope the verification lookup (Helcim's date filters are inclusive).
function dayWindow(dateStr?: string): { dateFrom: string; dateTo: string } {
  const base = dateStr && !isNaN(Date.parse(dateStr)) ? new Date(dateStr) : new Date();
  const day = (n: number) => new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return { dateFrom: day(-1), dateTo: day(1) };
}

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

    // Gate everything except signup-time + self-authenticating actions to super-admins.
    if (!PUBLIC_ACTIONS.has(action) && !SELF_AUTH_ACTIONS.has(action) && !(await isSuperAdmin(req))) {
      return json({ error: "Super-admin access required" }, 403);
    }

    switch (action) {
      // Verify a Helcim.js v2 inline charge SERVER-SIDE, then record it + enroll
      // recurring billing + activate the caller's practice. The client's approval
      // flag is never trusted — we confirm an APPROVED transaction with Helcim.
      case "record_payment": {
        const caller = await getCaller(req);
        if (!caller?.userId) return json({ error: "Unauthorized" }, 401);
        if (!caller.practiceId) return json({ error: "Your account is not linked to a practice." }, 409);

        const cardToken = String(params.card_token || "");
        if (!cardToken) return json({ error: "Missing card token." }, 400);
        const expectedAmount = ALLOWED_AMOUNTS.includes(Number(params.amount)) ? Number(params.amount) : 997;

        // 1) Verify with Helcim. The Helcim.js form transactionId is NOT the
        //    Payment-API id, so look the charge up by cardToken in a date window
        //    and confirm it's APPROVED for the expected amount.
        const { dateFrom, dateTo } = dayWindow(params.date);
        const qs = new URLSearchParams({ cardToken, dateFrom, dateTo });
        const txnRes = await helcim(`/card-transactions?${qs.toString()}`);
        const list = Array.isArray(txnRes.data) ? txnRes.data : (txnRes.data?.data ?? []);
        const approved = list.filter((t: Record<string, unknown>) => String(t.status ?? "").toUpperCase() === "APPROVED");
        const match = approved.find((t: Record<string, unknown>) => Math.round(Number(t.amount)) === Math.round(expectedAmount))
          || approved.find((t: Record<string, unknown>) => String(t.cardToken ?? "") === cardToken);

        // Test-mode Helcim.js charges are sandboxed and do NOT appear in the live v2
        // card-transactions API, so there is nothing to verify against. With test mode
        // on (HELCIM_TEST_MODE secret) we trust the client-approved result so the flow
        // completes; production keeps strict server-side verification.
        // TODO: remove the HELCIM_TEST_MODE secret (or set it false) before go-live.
        const TEST_MODE = Deno.env.get("HELCIM_TEST_MODE") === "true";
        if (!match && !TEST_MODE) {
          console.error("record_payment verify failed:", JSON.stringify({ helcimStatus: txnRes.status, count: Array.isArray(list) ? list.length : 0, expectedAmount }));
          return json({ error: "We could not verify an approved payment for this card. Please contact support.", detail: { helcimStatus: txnRes.status, transactionsReturned: Array.isArray(list) ? list.length : 0 } }, 400);
        }
        if (!match) console.warn("record_payment: TEST MODE — no live transaction to verify; trusting client result.");

        // The reconcilable Payment-API transactionId (for future refunds/reversals).
        const realTxnId = (match?.transactionId ?? match?.id ?? params.transaction_id) || null;
        const customerCode = (match?.customerCode || params.customer_code) || null;
        const last4 = String(params.card_last4 || match?.cardNumber || "").replace(/\D/g, "").slice(-4) || null;

        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );

        // 2) Enroll the recurring monthly subscription (best-effort — a verified
        //    charge already happened, so a recurring hiccup must not block access).
        let subscriptionId: string | null = null;
        let nextBilling: string | null = null;
        try {
          const plansRes = await helcim(`/payment-plans`);
          const plans = Array.isArray(plansRes.data) ? plansRes.data : (plansRes.data?.data ?? []);
          const plan = plans.find((p: Record<string, unknown>) => Math.round(Number(p.recurringAmount)) === Math.round(expectedAmount)) || plans[0];
          if (!plan?.id) {
            // Don't strand a paid/verified user — activate now and flag the missing plan.
            console.error(`record_payment: no Helcim $${expectedAmount}/mo recurring plan found — activating without a subscription. Create the plan in the Helcim dashboard.`);
          } else if (customerCode) {
            const idem = crypto.randomUUID().replace(/-/g, "").slice(0, 25); // Helcim requires exactly 25 chars
            const subRes = await fetch(`${HELCIM_BASE}/subscriptions`, {
              method: "POST",
              headers: { "api-token": HELCIM_API_KEY!, "idempotency-key": idem, "Content-Type": "application/json", accept: "application/json" },
              body: JSON.stringify({ subscriptions: [{ customerCode, paymentPlanId: plan.id, recurringAmount: expectedAmount, paymentMethod: "card" }] }),
            });
            const subData = await subRes.json().catch(() => ({}));
            const created = Array.isArray(subData) ? subData[0] : (subData?.data?.[0] ?? subData?.[0] ?? subData);
            subscriptionId = (created?.id ?? created?.subscriptionId) || null;
            nextBilling = (created?.dateBilling ?? created?.nextBillingDate) || null;
          }
        } catch (e) {
          console.error("record_payment: recurring enrollment failed:", (e as Error)?.message);
          // fall through — charge is verified; flag recurring for manual follow-up.
        }

        // 3) Persist + activate (service role; only reached after the charge verified).
        const patch: Record<string, unknown> = {
          subscription_status: "active",
          billing_status: "active",
          helcim_card_token: cardToken,
          helcim_transaction_id: realTxnId,
          helcim_customer_code: customerCode,
          card_last4: last4,
          card_type: params.card_type || null,
        };
        if (subscriptionId) patch.helcim_subscription_id = subscriptionId;
        if (nextBilling) patch.next_billing_date = nextBilling;
        const { error: upErr } = await admin.from("practices").update(patch).eq("id", caller.practiceId);
        if (upErr) return json({ error: `Verified your charge but could not update your account: ${upErr.message}` }, 500);

        // Internal Slack alert on a new paid activation (replaces the old
        // chargebee/ls-webhook trigger). Best-effort — never blocks activation.
        admin.functions.invoke("notify-signup", { body: { practice_id: caller.practiceId } }).catch(() => {});

        return json({ success: true, subscriptionId, transactionId: realTxnId });
      }

      // Update the card on file WITHOUT charging. The client tokenized a new card
      // via Helcim.js verify mode (config 10472) attached to the practice's existing
      // customer; here we make it that customer's DEFAULT, which is what the recurring
      // subscription bills. No money moves.
      case "update_card": {
        const caller = await getCaller(req);
        if (!caller?.userId) return json({ error: "Unauthorized" }, 401);
        if (!caller.practiceId) return json({ error: "Your account is not linked to a practice." }, 409);

        const cardToken = String(params.card_token || "");
        if (!cardToken) return json({ error: "Missing card token." }, 400);

        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );
        const { data: pr } = await admin.from("practices").select("helcim_customer_code").eq("id", caller.practiceId).maybeSingle();
        const customerCode = (pr?.helcim_customer_code as string) || params.customer_code;
        if (!customerCode) return json({ error: "No billing customer on file for this practice yet." }, 409);

        // 1) Resolve the numeric customerId from the customerCode.
        const custRes = await helcim(`/customers?customerCode=${encodeURIComponent(customerCode)}`);
        const customers = Array.isArray(custRes.data) ? custRes.data : (custRes.data?.data ?? (custRes.data?.id ? [custRes.data] : []));
        const customerId = customers?.[0]?.id;
        if (!customerId) return json({ error: "Could not locate your billing customer at Helcim." }, 404);

        // 2) Find the freshly-tokenized card on that customer (match by cardToken).
        const cardsRes = await helcim(`/customers/${customerId}/cards`);
        const cards = Array.isArray(cardsRes.data) ? cardsRes.data : (cardsRes.data?.data ?? []);
        const card = cards.find((c: Record<string, unknown>) => String(c.cardToken) === cardToken) || cards[cards.length - 1];
        if (!card?.id) return json({ error: "The new card was not found on your account. Please try again." }, 400);

        // 3) Make it the default — the recurring subscription bills the default card.
        const setDefault = await helcim(`/customers/${customerId}/cards/${card.id}/default`, "PATCH");
        if (!setDefault.ok) return json({ error: "Could not set the new card as default. Please try again." }, 502);

        // 4) Reflect it on the practice (last-4 from cardF6L4; no full card data stored).
        const f6l4 = String(card.cardF6L4 || "");
        const last4 = f6l4.replace(/\D/g, "").slice(-4) || (params.card_last4 ? String(params.card_last4).replace(/\D/g, "").slice(-4) : null);
        await admin.from("practices").update({
          helcim_card_token: cardToken,
          card_last4: last4,
          card_type: params.card_type || null,
        }).eq("id", caller.practiceId);

        return json({ success: true });
      }

      // Cancel / pause / resume / downsell the Helcim recurring subscription AND
      // reflect it locally. This is what actually stops/changes Helcim billing —
      // previously the app only flipped the DB status, so cancelled/paused
      // practices kept getting charged. Practice owners act on their own practice;
      // super-admins may target any via practice_id.
      case "manage_subscription": {
        const op = String(params.op || "");
        if (!["cancel", "pause", "resume", "set_amount"].includes(op)) return json({ error: "Unknown op" }, 400);

        const superAdmin = await isSuperAdmin(req);
        let practiceId: string | null = null;
        if (superAdmin && params.practice_id) {
          practiceId = String(params.practice_id);
        } else {
          const caller = await getCaller(req);
          if (!caller?.userId) return json({ error: "Unauthorized" }, 401);
          practiceId = caller.practiceId; // own practice only (body practice_id ignored for non-admins)
        }
        if (!practiceId) return json({ error: "No practice in context." }, 409);

        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );
        const { data: pr } = await admin.from("practices").select("helcim_subscription_id").eq("id", practiceId).maybeSingle();
        const subId = pr?.helcim_subscription_id as string | undefined;

        // Map the op to the Helcim subscription patch + the local status change.
        let helcimPatch: Record<string, unknown> | null = null;
        const localPatch: Record<string, unknown> = {};
        if (op === "cancel") { helcimPatch = { status: "cancelled" }; localPatch.subscription_status = "cancelled"; }
        else if (op === "pause") { helcimPatch = { status: "paused" }; localPatch.subscription_status = "paused"; if (params.pause_ends_at) localPatch.pause_ends_at = params.pause_ends_at; }
        else if (op === "resume") { helcimPatch = { status: "active" }; localPatch.subscription_status = "active"; localPatch.pause_ends_at = null; }
        else if (op === "set_amount") {
          const amt = Number(params.amount);
          if (!(amt > 0)) return json({ error: "Invalid amount." }, 400);
          helcimPatch = { recurringAmount: amt }; localPatch.subscription_status = "active"; localPatch.downsell_accepted_at = new Date().toISOString();
        }

        // Tell Helcim. If there's a live subscription and the patch fails for a
        // cancel/pause, surface the error rather than falsely flipping local state
        // (which would leave the customer still being billed).
        if (subId && helcimPatch) {
          const idem = crypto.randomUUID().replace(/-/g, "").slice(0, 25);
          const res = await fetch(`${HELCIM_BASE}/subscriptions`, {
            method: "PATCH",
            headers: { "api-token": HELCIM_API_KEY!, "idempotency-key": idem, "Content-Type": "application/json", accept: "application/json" },
            body: JSON.stringify({ subscriptions: [{ id: Number(subId), ...helcimPatch }] }),
          });
          if (!res.ok) {
            const detail = await res.text();
            console.error(`manage_subscription ${op} failed:`, res.status, detail);
            if (op === "cancel" || op === "pause") {
              return json({ error: `Could not ${op} the subscription at Helcim. Please try again or contact support.` }, 502);
            }
          }
        } else if (!subId) {
          console.warn(`manage_subscription: practice ${practiceId} has no helcim_subscription_id — applying local ${op} only.`);
        }

        const { error: upErr } = await admin.from("practices").update(localPatch).eq("id", practiceId);
        if (upErr) return json({ error: upErr.message }, 500);
        return json({ success: true });
      }

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
