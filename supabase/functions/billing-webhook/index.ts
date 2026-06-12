import { reportEdgeError } from "../_shared/report-error.ts";
// billing-webhook — receives Helcim transaction events and reconciles the
// practice's billing status. Registered in the Helcim dashboard as the Deliver URL:
//   https://eymgqjeudrmeofytnwgs.supabase.co/functions/v1/billing-webhook
//
// NB on the name: Helcim's V2 webhook system rejects any Deliver URL that
// contains the word "helcim" anywhere in the string (an anti-spoofing
// guardrail), so this function is deliberately named "billing-webhook" rather
// than "helcim-webhook" — the URL must stay vendor-name-free.
//
// verify_jwt=false (Helcim won't send a Supabase JWT). Instead every request is
// authenticated by an HMAC signature: Helcim signs each delivery with the
// account's Verifier Token (Helcim dashboard → Webhooks) using the Svix scheme
// — HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${rawBody}`, base64,
// sent in the `webhook-signature` header. We recompute it with
// HELCIM_WEBHOOK_VERIFIER_TOKEN and reject (401) anything that doesn't match,
// logging the rejection to audit_logs. Only after verification do we touch
// state — and we only flip billing flags here, never move money.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HELCIM_WEBHOOK_VERIFIER_TOKEN.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { clientMeta, recordAudit } from "../_shared/audit.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Replay window (seconds): reject deliveries whose timestamp is too far from now.
const TOLERANCE_SECONDS = 600;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function bytesToB64(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}
async function hmacB64(keyBytes: Uint8Array, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return bytesToB64(sig);
}
// Constant-time string compare.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Verify the Svix-style signature. Helcim's Verifier Token may be a base64
// secret (optionally `whsec_`-prefixed) or a raw string — try both keyings.
async function verifySignature(secretRaw: string, id: string, ts: string, sigHeader: string, body: string): Promise<boolean> {
  let secret = secretRaw.trim();
  if (secret.startsWith("whsec_")) secret = secret.slice(6);
  const signed = `${id}.${ts}.${body}`;
  // header is a space-delimited list of `v1,<sig>` entries.
  const provided = sigHeader.split(/\s+/).map((p) => (p.includes(",") ? p.slice(p.indexOf(",") + 1) : p)).filter(Boolean);
  if (!provided.length) return false;

  const candidates: Uint8Array[] = [];
  try { candidates.push(b64ToBytes(secret)); } catch { /* not base64 */ }
  candidates.push(new TextEncoder().encode(secret));

  for (const keyBytes of candidates) {
    const expected = await hmacB64(keyBytes, signed);
    if (provided.some((p) => safeEqual(p, expected))) return true;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  // Helcim validates the Deliver URL when you save it (and health-checks it).
  // Acknowledge any non-POST probe (GET/HEAD/OPTIONS/etc.) with 200 so the URL
  // can be saved; only POST carries an actual event to process.
  if (req.method !== "POST") return json({ ok: true }, 200);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { ipAddress, userAgent } = clientMeta(req);
  const body = await req.text(); // raw body required for signature verification

  try {
    const id = req.headers.get("webhook-id") || "";
    const ts = req.headers.get("webhook-timestamp") || "";
    const sig = req.headers.get("webhook-signature") || "";

    // No signature headers at all → a validation/handshake ping. Ack without
    // acting (it carries no event to process and nothing to verify).
    if (!id && !ts && !sig) return json({ ok: true, ping: true }, 200);

    // --- A signed delivery: authenticate before touching its payload. ---
    const secret = Deno.env.get("HELCIM_WEBHOOK_VERIFIER_TOKEN");
    if (!secret) {
      // Setup window: the verifier secret isn't configured yet (e.g. Helcim's
      // save-time test delivery, before the token has been copied into secrets).
      // We can't verify, so we DON'T process — but we acknowledge (200) rather
      // than 503 so Helcim can save the endpoint. Set HELCIM_WEBHOOK_VERIFIER_TOKEN
      // to switch on real verification + processing.
      console.error("billing-webhook: HELCIM_WEBHOOK_VERIFIER_TOKEN is not set — acknowledging without processing.");
      return json({ ok: true, unverified: true }, 200);
    }

    if (!id || !ts || !sig) {
      await recordAudit(admin, {
        action: "billing.webhook_rejected", resourceType: "helcim_webhook",
        details: { reason: "missing_signature_headers" }, ipAddress, userAgent,
      });
      return json({ error: "Missing signature headers" }, 401);
    }

    const tsNum = Number(ts);
    const fresh = Number.isFinite(tsNum) && Math.abs(Date.now() / 1000 - tsNum) <= TOLERANCE_SECONDS;
    const signatureOk = await verifySignature(secret, id, ts, sig, body);
    if (!fresh || !signatureOk) {
      await recordAudit(admin, {
        action: "billing.webhook_rejected", resourceType: "helcim_webhook", resourceId: id,
        details: { reason: !signatureOk ? "bad_signature" : "stale_timestamp", webhook_id: id, webhook_timestamp: ts },
        ipAddress, userAgent,
      });
      return json({ error: "Invalid signature" }, 401);
    }

    // --- Verified: reconcile billing state. ---
    const evt = JSON.parse(body || "{}");
    // Helcim event shape varies; tolerate a few common keys.
    const type = String(evt.type || evt.eventName || evt.event || "").toLowerCase();
    const txnId = String(evt.transactionId || evt.id || evt.data?.transactionId || "");
    const customerCode = String(evt.customerCode || evt.data?.customerCode || "");

    // Resolve the practice by customer code, then transaction id.
    let practice: { id: string } | null = null;
    if (customerCode) {
      const { data } = await admin.from("practices").select("id").eq("helcim_customer_code", customerCode).maybeSingle();
      practice = data;
    }
    if (!practice && txnId) {
      const { data } = await admin.from("practices").select("id").eq("helcim_transaction_id", txnId).maybeSingle();
      practice = data;
    }

    if (type.includes("approv") && practice) {
      await admin.from("practices").update({ subscription_status: "active", billing_status: "active", billing_retry_count: 0, helcim_transaction_id: txnId || undefined }).eq("id", practice.id);
    } else if (type.includes("declin") || type.includes("fail")) {
      if (practice) {
        await admin.from("practices").update({ subscription_status: "past_due", billing_status: "past_due" }).eq("id", practice.id);
        await admin.functions.invoke("notify-payment-failure", { body: { practice_id: practice.id } }).catch(() => {});
      }
    } else if (type.includes("refund") && practice) {
      await admin.from("practices").update({ subscription_status: "cancelled" }).eq("id", practice.id);
    }

    return json({ ok: true, matched: Boolean(practice) });
  } catch (e) {
    await reportEdgeError("billing-webhook", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
