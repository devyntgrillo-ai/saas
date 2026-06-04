import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// chargebee-webhook - Chargebee webhook receiver for CaseLift billing.
//
// Chargebee calls this endpoint (server-to-server, no user JWT) whenever a
// billing event happens. We map the event back to a practice - via the stored
// chargebee_customer_id / chargebee_subscription_id, or the practice_id we
// stashed in the hosted page's pass_thru_content at checkout - and update its
// subscription state.
//
// Handled events:
//   subscription_created   → status=active, capture subscription id + period end
//   subscription_renewed   → refresh current_period_end / next_billing_date
//   subscription_changed   → refresh plan + status + period end
//   payment_failed         → status=past_due, fire notify-payment-failure
//   subscription_cancelled → status=cancelled
//   subscription_deleted   → status=expired
//
// This function must be deployed with verify_jwt = false (callers are
// Chargebee, not signed-in users). See config.toml. Authenticity is enforced
// via CHARGEBEE_WEBHOOK_SECRET when set.
//
// Authentication: Chargebee does not sign webhooks with an HMAC; it secures
// them with HTTP Basic Auth credentials you configure on the webhook (or a
// secret in the URL). We treat CHARGEBEE_WEBHOOK_SECRET as that shared secret
// and accept it as the Basic-auth username OR password, or as a ?key= /
// ?secret= query param - whichever the dashboard webhook is configured with.
//
// Secrets (set via `supabase secrets set`):
//   SUPABASE_SERVICE_ROLE_KEY  - to write across practices (bypasses RLS)
//   CHARGEBEE_WEBHOOK_SECRET   - shared secret for request verification
//                                (optional but strongly recommended)
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { cbTimestampToDate, cbTimestampToIso } from "../_shared/chargebee.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Verify the shared secret via HTTP Basic Auth (the secure method supported by
// Chargebee webhook config). Query-parameter fallback was removed to avoid
// secret leakage in proxy logs (audit finding 2).
function verifySecret(req: Request, _url: URL, secret: string): boolean {
  const auth = req.headers.get("Authorization") || "";
  if (auth.startsWith("Basic ")) {
    try {
      const [user, pass] = atob(auth.slice(6)).split(":");
      if (user === secret || pass === secret) return true;
    } catch { /* malformed header */ }
  }
  return false;
}

// Map a Chargebee subscription.status to our subscription_status values.
function mapCbStatus(s: string): string {
  switch (s) {
    case "active":
    case "in_trial":
    case "non_renewing": return "active";
    case "future": return "active";
    case "paused": return "paused";
    case "cancelled": return "cancelled";
    default: return "active";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const rawBody = await req.text();

    // --- Verify authenticity (if a shared secret is configured). ---
    const secret = Deno.env.get("CHARGEBEE_WEBHOOK_SECRET");
    if (secret) {
      if (!verifySecret(req, url, secret)) {
        console.warn("chargebee-webhook: invalid or missing webhook secret");
        return json({ error: "Invalid webhook credentials" }, 401);
      }
    } else {
      console.warn("chargebee-webhook: CHARGEBEE_WEBHOOK_SECRET not set - skipping verification");
    }

    const payload = JSON.parse(rawBody);
    const eventType: string = payload?.event_type || "";
    const content = payload?.content ?? {};
    const subscription = content?.subscription ?? {};
    const customer = content?.customer ?? {};

    const customerId: string | null = subscription?.customer_id ?? customer?.id ?? null;
    const subscriptionId: string | null = subscription?.id != null ? String(subscription.id) : null;

    // practice_id may have been carried through the hosted page at checkout.
    let practiceIdFromMeta: string | null = null;
    try {
      const passThru = content?.hosted_page?.pass_thru_content || subscription?.cf_practice_id;
      if (typeof passThru === "string" && passThru.startsWith("{")) {
        practiceIdFromMeta = JSON.parse(passThru)?.practice_id ?? null;
      }
    } catch { /* no pass-thru */ }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // --- Resolve which practice this event belongs to. ---
    let practiceId = practiceIdFromMeta;
    if (!practiceId && subscriptionId) {
      const { data } = await admin
        .from("practices")
        .select("id")
        .eq("chargebee_subscription_id", subscriptionId)
        .maybeSingle();
      practiceId = data?.id ?? null;
    }
    if (!practiceId && customerId) {
      const { data } = await admin
        .from("practices")
        .select("id")
        .eq("chargebee_customer_id", customerId)
        .maybeSingle();
      practiceId = data?.id ?? null;
    }

    if (!practiceId) {
      // Acknowledge so Chargebee doesn't retry forever, but record the miss.
      console.warn(`chargebee-webhook: no practice for event ${eventType}`);
      return json({ ok: true, ignored: true, reason: "no matching practice" });
    }

    // --- Build the patch for this event. ---
    const patch: Record<string, unknown> = {};
    if (customerId) patch.chargebee_customer_id = customerId;
    if (subscriptionId) patch.chargebee_subscription_id = subscriptionId;

    // current_term_end is a unix timestamp in seconds.
    const periodEndIso = cbTimestampToIso(subscription?.current_term_end);
    const periodEndDate = cbTimestampToDate(subscription?.next_billing_at ?? subscription?.current_term_end);

    let notifyFailure = false;

    switch (eventType) {
      case "subscription_created":
        patch.subscription_status = "active";
        if (periodEndIso) patch.current_period_end = periodEndIso;
        if (periodEndDate) patch.next_billing_date = periodEndDate;
        break;

      case "subscription_renewed":
        patch.subscription_status = "active";
        if (periodEndIso) patch.current_period_end = periodEndIso;
        if (periodEndDate) patch.next_billing_date = periodEndDate;
        break;

      case "subscription_changed":
        if (typeof subscription?.status === "string") {
          patch.subscription_status = mapCbStatus(subscription.status);
        }
        if (periodEndIso) patch.current_period_end = periodEndIso;
        if (periodEndDate) patch.next_billing_date = periodEndDate;
        break;

      case "payment_failed":
        patch.subscription_status = "past_due";
        notifyFailure = true;
        break;

      case "subscription_cancelled":
        patch.subscription_status = "cancelled";
        if (periodEndDate) patch.next_billing_date = periodEndDate;
        break;

      case "subscription_deleted":
        patch.subscription_status = "expired";
        break;

      default:
        // Unhandled event - we may still have refreshed the Chargebee ids above.
        if (Object.keys(patch).length === 0) {
          return json({ ok: true, ignored: true, event: eventType });
        }
    }

    const { error } = await admin.from("practices").update(patch).eq("id", practiceId);
    if (error) throw error;

    // Fire-and-forget payment-failure notification (email to admin/reseller/super-admin).
    if (notifyFailure) {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-payment-failure`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ practice_id: practiceId }),
      }).catch((e) => console.error("notify-payment-failure trigger failed:", e));
    }

    return json({ ok: true, event: eventType, practice_id: practiceId });
  } catch (e) {
    await reportEdgeError("chargebee-webhook", e);
    console.error("chargebee-webhook error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
