import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// process-billing-renewals — daily self-managed recurring billing for practices
// that Helcim is NOT already auto-charging via a Helcim subscription.
//
// IMPORTANT (no double-charge): monthly customers are billed automatically by
// their Helcim recurring subscription (practices.helcim_subscription_id). This
// job MUST therefore only ever charge practices where helcim_subscription_id IS
// NULL — i.e. annual customers (upgrade_annual cancels the monthly sub) and any
// active practice whose subscription enrollment didn't take. Charging a
// Helcim-subscription practice here would bill them twice.
//
// For each due practice we charge the stored card token via the Helcim
// Payment API. On success: advance next_billing_date, reset retries. On
// failure: increment billing_retry_count, retry in 3 days, email + Slack; after
// 3 failures mark past_due (which RequireActiveBilling blocks on in-app).
//
// Internal job: verify_jwt=false but gated to the service-role bearer (pg_cron
// sends it). Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HELCIM_API_KEY,
// optional SLACK alerting via the notify-slack function.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const HELCIM_API_KEY = Deno.env.get("HELCIM_API_KEY");
const HELCIM_BASE = "https://api.helcim.com/v2";
const MAX_RETRIES = 3;
const RETRY_DAYS = 3;
const BATCH = 200;

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const DAY_MS = 86_400_000;

// Deterministic 25-char idempotency key (Helcim requires exactly 25 chars) so a
// re-run on the same billing period never charges the same practice twice.
async function idemKey(practiceId: string, period: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${practiceId}:${period}`));
  const arr = new Uint8Array(buf);
  let hex = "";
  for (const b of arr) hex += b.toString(16).padStart(2, "0");
  return hex.slice(0, 25);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!HELCIM_API_KEY) return json({ error: "Helcim is not configured (missing HELCIM_API_KEY secret)." }, 503);

  // Gate strictly to the service role — this moves real money.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (token !== serviceKey) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const nowIso = new Date().toISOString();
    // Due = ACTIVE (never past_due — those are excluded until they recover so we
    // don't re-charge daily), NOT Helcim-subscription-managed, has a card on file,
    // and the next billing date has arrived. Failed attempts stay active with
    // next_billing_date = now+3d so they're retried in 3 days.
    const { data: due, error } = await admin
      .from("practices")
      .select("id, name, plan_amount, annual_amount, billing_interval, helcim_card_token, helcim_customer_code, billing_retry_count, next_billing_date")
      .is("helcim_subscription_id", null)
      .not("helcim_card_token", "is", null)
      .eq("subscription_status", "active")
      .lte("next_billing_date", nowIso)
      .limit(BATCH);
    if (error) return json({ error: error.message }, 500);

    const results: { charged: number; failed: number; past_due: number } = { charged: 0, failed: 0, past_due: 0 };

    for (const p of due ?? []) {
      const annual = p.billing_interval === "annual";
      const amount = annual ? Number(p.annual_amount) || (Number(p.plan_amount) || 0) * 10 : Number(p.plan_amount) || 0;
      if (!(amount > 0) || !p.helcim_card_token) continue;

      const period = String(p.next_billing_date || nowIso).slice(0, 10);
      const idem = await idemKey(p.id, period);
      let approved = false;
      let txnId: string | null = null;
      try {
        const res = await fetch(`${HELCIM_BASE}/payment/purchase`, {
          method: "POST",
          headers: { "api-token": HELCIM_API_KEY!, "idempotency-key": idem, "Content-Type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            amount,
            currency: "USD",
            ipAddress: "0.0.0.0",
            customerCode: p.helcim_customer_code || undefined,
            cardData: { cardToken: p.helcim_card_token },
          }),
        });
        const data = await res.json().catch(() => ({}));
        approved = res.ok && String(data.status ?? "").toUpperCase() === "APPROVED";
        txnId = (data.transactionId ?? data.id) || null;
        if (!approved) console.error(`billing-renewals: charge declined for ${p.id}:`, res.status, JSON.stringify(data).slice(0, 200));
      } catch (e) {
        console.error(`billing-renewals: charge threw for ${p.id}:`, (e as Error)?.message);
      }

      if (approved) {
        const next = new Date(Date.now() + (annual ? 365 : 30) * DAY_MS).toISOString();
        await admin.from("practices").update({
          subscription_status: "active",
          billing_status: "active",
          billing_retry_count: 0,
          next_billing_date: next,
          ...(txnId ? { helcim_transaction_id: txnId } : {}),
        }).eq("id", p.id);
        results.charged++;
        continue;
      }

      // Failed: bump retry count; retry in 3 days, or give up after MAX_RETRIES.
      const retries = (Number(p.billing_retry_count) || 0) + 1;
      if (retries >= MAX_RETRIES) {
        await admin.from("practices").update({
          subscription_status: "past_due",
          billing_status: "past_due",
          billing_retry_count: retries,
        }).eq("id", p.id);
        results.past_due++;
      } else {
        await admin.from("practices").update({
          billing_status: "retrying",
          billing_retry_count: retries,
          next_billing_date: new Date(Date.now() + RETRY_DAYS * DAY_MS).toISOString(),
        }).eq("id", p.id);
        results.failed++;
      }
      // Notify the practice (email) + the team (Slack). Best-effort.
      admin.functions.invoke("notify-payment-failure", { body: { practice_id: p.id } }).catch(() => {});
      admin.functions.invoke("notify-slack", {
        body: { text: `:credit_card: Renewal charge failed for *${p.name || p.id}* (attempt ${retries}/${MAX_RETRIES}${retries >= MAX_RETRIES ? ", now past_due" : ", retry in 3d"}).` },
      }).catch(() => {});
    }

    return json({ ok: true, processed: (due ?? []).length, ...results });
  } catch (e) {
    await reportEdgeError("process-billing-renewals", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
