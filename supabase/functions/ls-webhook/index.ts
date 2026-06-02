// ============================================================================
// ls-webhook - Lemon Squeezy webhook receiver for Hope AI billing.
//
// Lemon Squeezy calls this endpoint (server-to-server, no user JWT) whenever a
// billing event happens. We map the event back to a practice - via the
// custom_data.practice_id we attached at checkout, falling back to the stored
// Lemon Squeezy subscription / customer id - and update its subscription state.
//
// Handled events:
//   order_created               → subscription active
//   subscription_created        → subscription active (captures subscription id)
//   subscription_cancelled      → subscription_status = 'cancelled'
//   subscription_payment_failed → subscription_status = 'past_due'
//
// This function must be deployed with verify_jwt = false (callers are Lemon
// Squeezy, not signed-in users). Authenticity is enforced via the signed
// X-Signature header instead.
//
// Secrets (set via `supabase secrets set`):
//   SUPABASE_SERVICE_ROLE_KEY    - to write across practices (bypasses RLS)
//   LEMONSQUEEZY_WEBHOOK_SECRET  - signing secret for X-Signature verification
//                                  (optional but strongly recommended)
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Constant-time-ish hex comparison to avoid leaking timing information.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function verifySignature(secret: string, rawBody: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return safeEqual(expected, (signature || "").toLowerCase());
}

// Lemon Squeezy timestamps are ISO strings; the next_billing_date column is a date.
const toDate = (iso: unknown): string | null =>
  typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : null;

// Map a Lemon Squeezy subscription.status to our subscription_status values.
function mapLsStatus(s: string): string {
  switch (s) {
    case "active":
    case "on_trial": return "active";
    case "past_due": return "past_due";
    case "unpaid": return "unpaid";
    case "cancelled": return "cancelled";
    case "expired": return "expired";
    case "paused": return "paused";
    default: return "active";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const rawBody = await req.text();

    // --- Verify authenticity (if a signing secret is configured). ---
    const secret = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET");
    if (secret) {
      const signature = req.headers.get("X-Signature") || "";
      const ok = await verifySignature(secret, rawBody, signature);
      if (!ok) {
        console.warn("ls-webhook: invalid signature");
        return json({ error: "Invalid signature" }, 401);
      }
    } else {
      console.warn("ls-webhook: LEMONSQUEEZY_WEBHOOK_SECRET not set - skipping signature verification");
    }

    const payload = JSON.parse(rawBody);
    const eventName: string =
      payload?.meta?.event_name || req.headers.get("X-Event-Name") || "";
    const customData = payload?.meta?.custom_data ?? {};
    const resource = payload?.data ?? {};
    const attrs = resource?.attributes ?? {};

    const practiceIdFromMeta: string | null = customData?.practice_id ?? null;
    const lsResourceId: string | null = resource?.id ? String(resource.id) : null;
    const customerId: string | null =
      attrs?.customer_id != null ? String(attrs.customer_id) : null;
    // For subscription events, the resource id IS the subscription id. For
    // order events there is no subscription id on the order itself.
    const subscriptionId = eventName.startsWith("subscription") ? lsResourceId : null;

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
        .eq("ls_subscription_id", subscriptionId)
        .maybeSingle();
      practiceId = data?.id ?? null;
    }
    if (!practiceId && customerId) {
      const { data } = await admin
        .from("practices")
        .select("id")
        .eq("ls_customer_id", customerId)
        .maybeSingle();
      practiceId = data?.id ?? null;
    }

    if (!practiceId) {
      // Acknowledge so Lemon Squeezy doesn't retry forever, but record the miss.
      console.warn(`ls-webhook: no practice for event ${eventName}`);
      return json({ ok: true, ignored: true, reason: "no matching practice" });
    }

    // --- Build the patch for this event. ---
    const patch: Record<string, unknown> = {};
    if (customerId) patch.ls_customer_id = customerId;
    if (subscriptionId) patch.ls_subscription_id = subscriptionId;
    if (attrs?.variant_id != null) patch.ls_variant_id = String(attrs.variant_id);

    let notifyFailure = false;

    switch (eventName) {
      case "order_created":
      case "subscription_created":
      case "subscription_resumed":
      case "subscription_unpaused":
        patch.subscription_status = "active";
        patch.subscription_started_at = new Date().toISOString();
        if (attrs?.renews_at) {
          patch.next_billing_date = toDate(attrs.renews_at);
          patch.current_period_end = attrs.renews_at;
        }
        break;

      case "subscription_updated":
        // Reflect LS's own status when present; refresh the period end.
        if (typeof attrs?.status === "string") patch.subscription_status = mapLsStatus(attrs.status);
        if (attrs?.renews_at) {
          patch.next_billing_date = toDate(attrs.renews_at);
          patch.current_period_end = attrs.renews_at;
        }
        if (attrs?.status === "past_due" || attrs?.status === "unpaid") notifyFailure = true;
        break;

      case "subscription_payment_success":
        patch.subscription_status = "active";
        if (attrs?.renews_at) {
          patch.next_billing_date = toDate(attrs.renews_at);
          patch.current_period_end = attrs.renews_at;
        }
        break;

      case "subscription_cancelled":
        patch.subscription_status = "cancelled";
        if (attrs?.ends_at || attrs?.renews_at) patch.next_billing_date = toDate(attrs.ends_at ?? attrs.renews_at);
        break;

      case "subscription_expired":
        patch.subscription_status = "expired";
        if (attrs?.ends_at || attrs?.renews_at) patch.next_billing_date = toDate(attrs.ends_at ?? attrs.renews_at);
        break;

      case "subscription_payment_failed":
      case "subscription_past_due":
        patch.subscription_status = "past_due";
        notifyFailure = true;
        break;

      default:
        // Unhandled event - we may still have refreshed the LS ids above.
        if (Object.keys(patch).length === 0) {
          return json({ ok: true, ignored: true, event: eventName });
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

    return json({ ok: true, event: eventName, practice_id: practiceId });
  } catch (e) {
    console.error("ls-webhook error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
