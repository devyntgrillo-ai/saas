import "jsr:@supabase/functions-js/edge-runtime.d.ts";

export interface LSConfig {
  apiKey: string;
  storeId: string;
  variantId: string;
}

export function lsConfig(): LSConfig | null {
  const apiKey = Deno.env.get("LEMONSQUEEZY_API_KEY")?.trim();
  const storeId = Deno.env.get("LEMONSQUEEZY_STORE_ID")?.trim();
  const variantId = Deno.env.get("LEMONSQUEEZY_VARIANT_ID")?.trim();
  if (!apiKey || !storeId || !variantId) return null;
  return { apiKey, storeId, variantId };
}

export function lsHeaders(cfg: LSConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
}

export async function lsRequest<T = unknown>(
  cfg: LSConfig,
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const url = `https://api.lemonsqueezy.com/v1${path}`;
  const headers = lsHeaders(cfg);
  const opts: RequestInit = { method, headers };
  if (body !== undefined && method !== "GET") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const raw = await res.text();
  if (!res.ok) {
    let detail = raw;
    try {
      const err = JSON.parse(raw);
      detail = err?.errors?.[0]?.detail || err?.error || raw;
    } catch { /* keep raw */ }
    throw new Error(`LS API ${method} ${path} ${res.status}: ${detail}`);
  }
  return raw ? JSON.parse(raw) : {} as T;
}

export async function createLSCustomer(
  cfg: LSConfig,
  email: string,
  name?: string,
): Promise<{ id: string }> {
  const res = await lsRequest<{ data: { id: string } }>(cfg, "/customers", "POST", {
    data: {
      type: "customers",
      attributes: {
        email,
        name: name || email,
      },
    },
  });
  return { id: res.data.id };
}

export async function findLSCustomerByEmail(
  cfg: LSConfig,
  email: string,
): Promise<{ id: string } | null> {
  const res = await lsRequest<{ data: Array<{ id: string; attributes: { email: string } }> }>(
    cfg,
    `/customers?filter[email]=${encodeURIComponent(email)}`,
    "GET",
  );
  const match = res.data?.find((c) => c.attributes.email === email);
  return match ? { id: match.id } : null;
}

export async function createLSCheckout(
  cfg: LSConfig,
  variantId: string,
  opts: {
    email?: string;
    name?: string;
    customData?: Record<string, unknown>;
    redirectUrl?: string;
    embed?: boolean;
  } = {},
): Promise<{ url: string; id: string }> {
  const body: Record<string, unknown> = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          email: opts.email,
          name: opts.name,
          custom: opts.customData ?? {},
        },
        product_options: {
          redirect_url: opts.redirectUrl,
        },
        checkout_options: {
          embed: opts.embed ?? false,
        },
      },
      relationships: {
        store: { data: { type: "stores", id: cfg.storeId } },
        variant: { data: { type: "variants", id: variantId } },
      },
    },
  };
  const res = await lsRequest<{ data: { id: string; attributes: { url: string } } }>(
    cfg,
    "/checkouts",
    "POST",
    body,
  );
  return { url: res.data.attributes.url, id: res.data.id };
}

export async function cancelLSSubscription(
  cfg: LSConfig,
  subscriptionId: string,
): Promise<void> {
  await lsRequest(cfg, `/subscriptions/${subscriptionId}/cancel`, "POST", {});
}

export async function getLSSubscription(
  cfg: LSConfig,
  subscriptionId: string,
): Promise<{
  id: string;
  attributes: {
    customer_id: number;
    order_id: number;
    product_id: number;
    variant_id: number;
    status: string;
    status_formatted: string;
    trial_ends_at: string | null;
    renews_at: string | null;
    ends_at: string | null;
    created_at: string;
    updated_at: string;
    test_mode: boolean;
  };
}> {
  const res = await lsRequest<{ data: { id: string; attributes: Record<string, unknown> } }>(
    cfg,
    `/subscriptions/${subscriptionId}`,
    "GET",
  );
  return res.data as any;
}

export async function verifyLSWebhook(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = hexToBytes(signature);
    return await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(body));
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function mapLSStatus(status: string): string {
  switch (status) {
    case "active":
    case "on_trial":
      return "active";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "active";
  }
}
