import { reportEdgeError } from "../_shared/report-error.ts";
// helcim-webhook, receives Helcim transaction events and reconciles the
// practice's billing status. Registered in the Helcim dashboard:
//   https://eymgqjeudrmeofytnwgs.supabase.co/functions/v1/helcim-webhook
//
// verify_jwt=false (Helcim won't send a Supabase JWT). We match the event to a
// practice by its stored helcim_customer_code / transaction id and only flip
// billing state, no money movement happens here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const evt = await req.json().catch(() => ({}));
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
      await admin.from("practices").update({ subscription_status: "active", helcim_transaction_id: txnId || undefined }).eq("id", practice.id);
    } else if (type.includes("declin") || type.includes("fail")) {
      if (practice) {
        await admin.from("practices").update({ subscription_status: "past_due" }).eq("id", practice.id);
        await admin.functions.invoke("notify-payment-failure", { body: { practice_id: practice.id } }).catch(() => {});
      }
    } else if (type.includes("refund") && practice) {
      await admin.from("practices").update({ subscription_status: "cancelled" }).eq("id", practice.id);
    }

    return json({ ok: true, matched: Boolean(practice) });
  } catch (e) {
    await reportEdgeError("helcim-webhook", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
