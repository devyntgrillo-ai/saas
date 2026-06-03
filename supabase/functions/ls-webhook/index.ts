import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyLSWebhook, mapLSStatus, lsConfig } from "../_shared/lemonsqueezy.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const rawBody = await req.text();

    const secret = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET");
    if (secret) {
      const signature = req.headers.get("X-Signature") || "";
      if (!signature) {
        console.warn("ls-webhook: missing X-Signature header");
        return json({ error: "Missing signature" }, 401);
      }
      const valid = await verifyLSWebhook(rawBody, signature, secret);
      if (!valid) {
        console.warn("ls-webhook: invalid signature");
        return json({ error: "Invalid signature" }, 401);
      }
    } else {
      console.warn("ls-webhook: LEMONSQUEEZY_WEBHOOK_SECRET not set - skipping verification");
    }

    const payload = JSON.parse(rawBody);
    const meta = payload?.meta ?? {};
    const eventName: string = meta?.event_name ?? "";
    const data = payload?.data ?? {};
    const attributes = data?.attributes ?? {};
    const customData = meta?.custom_data ?? payload?.custom_data ?? {};

    const customerId: string | null = attributes?.customer_id != null
      ? String(attributes.customer_id)
      : meta?.customer_id
      ? String(meta.customer_id)
      : null;

    const subscriptionId: string | null = data?.id ? String(data.id) : null;
    const orderId: string | null = attributes?.order_id != null
      ? String(attributes.order_id)
      : meta?.order_id
      ? String(meta.order_id)
      : null;

    const productId: string | null = attributes?.product_id != null
      ? String(attributes.product_id)
      : null;

    const variantId: string | null = attributes?.variant_id != null
      ? String(attributes.variant_id)
      : null;

    let practiceIdFromCustom: string | null = null;
    if (customData?.practice_id) {
      practiceIdFromCustom = String(customData.practice_id);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    let practiceId = practiceIdFromCustom;
    if (!practiceId && customerId) {
      const { data: p } = await admin
        .from("practices")
        .select("id")
        .eq("ls_customer_id", customerId)
        .maybeSingle();
      practiceId = p?.id ?? null;
    }
    if (!practiceId && subscriptionId) {
      const { data: p } = await admin
        .from("practices")
        .select("id")
        .eq("ls_subscription_id", subscriptionId)
        .maybeSingle();
      practiceId = p?.id ?? null;
    }

    if (!practiceId) {
      console.warn(`ls-webhook: no practice for event ${eventName}`);
      return json({ ok: true, ignored: true, reason: "no matching practice" });
    }

    const patch: Record<string, unknown> = {};

    if (customerId) patch.ls_customer_id = customerId;
    if (subscriptionId) patch.ls_subscription_id = subscriptionId;
    if (orderId) patch.ls_order_id = orderId;
    if (productId) patch.ls_product_id = productId;
    if (variantId) patch.ls_variant_id = variantId;

    const renewsAt: string | null = attributes?.renews_at ?? null;
    const endsAt: string | null = attributes?.ends_at ?? null;
    const trialEndsAt: string | null = attributes?.trial_ends_at ?? null;

    let notifyFailure = false;

    switch (eventName) {
      case "order_created":
        if (!patch.ls_order_id) patch.ls_order_id = orderId;
        await admin.from("practices").update(patch).eq("id", practiceId);
        return json({ ok: true, event: eventName, practice_id: practiceId });

      case "subscription_created":
        patch.subscription_status = "active";
        if (renewsAt) patch.current_period_end = renewsAt;
        if (trialEndsAt) patch.trial_ends_at = trialEndsAt;
        break;

      case "subscription_updated":
        if (typeof attributes?.status === "string") {
          patch.subscription_status = mapLSStatus(attributes.status);
        }
        if (renewsAt) patch.current_period_end = renewsAt;
        break;

      case "subscription_payment_success":
        patch.subscription_status = "active";
        if (renewsAt) patch.current_period_end = renewsAt;
        if (endsAt) patch.trial_ends_at = endsAt;
        break;

      case "subscription_payment_failed":
        patch.subscription_status = "past_due";
        notifyFailure = true;
        break;

      case "subscription_payment_recovered":
        patch.subscription_status = "active";
        break;

      case "subscription_cancelled":
        patch.subscription_status = "cancelled";
        if (endsAt) patch.current_period_end = endsAt;
        break;

      case "subscription_expired":
        patch.subscription_status = "expired";
        break;

      case "subscription_resumed":
        patch.subscription_status = "active";
        break;

      case "subscription_paused":
        patch.subscription_status = "paused";
        break;

      case "subscription_unpaused":
        patch.subscription_status = "active";
        break;

      default:
        if (Object.keys(patch).length <= Object.keys({ customerId, subscriptionId, orderId, productId, variantId }).filter(Boolean).length) {
          return json({ ok: true, ignored: true, event: eventName });
        }
    }

    const { error } = await admin.from("practices").update(patch).eq("id", practiceId);
    if (error) throw error;

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
