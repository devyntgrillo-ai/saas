// ============================================================================
// bill-resellers - monthly wholesale billing of resellers (cron, service role).
//
// On the 1st of each month (scheduled via pg_cron, see the cron migration), for
// every reseller we:
//   1. Count their active subaccounts (client practices whose subscription is
//      live - 'active' or 'trial'; cancelled/suspended/paused are excluded).
//   2. Ensure the reseller has a Chargebee customer (create + persist one from
//      their owner email if missing).
//   3. Create a one-off Chargebee invoice for active_count x $297, auto-collected.
//      Chargebee emails the invoice/receipt to the reseller's customer email.
//   4. If the charge isn't paid (payment_due / not_paid), suspend the reseller so
//      their client subaccounts show a "service paused" banner until they pay.
//
// Idempotency: this is intended to run once a month. A `dry_run` body flag
// previews counts/amounts without touching Chargebee, and `agency_id` bills a
// single reseller (used by the admin "Bill now" action).
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHARGEBEE_SITE, CHARGEBEE_API_KEY.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { chargebeeConfig, chargebeeRequest } from "../_shared/chargebee.ts";

// Wholesale price CaseLift charges resellers per active subaccount, in cents.
const WHOLESALE_CENTS = 29_700; // $297.00
// Subaccount statuses that count as "active" for wholesale billing.
const ACTIVE_STATUSES = ["active", "trial", "trialing"];

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cfg = chargebeeConfig();

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body?.dry_run === true;
    const onlyAgencyId: string | null = body?.agency_id ?? null;

    if (!cfg && !dryRun) {
      return json({ error: "Billing isn't configured (CHARGEBEE_SITE / CHARGEBEE_API_KEY not set)." }, 503);
    }

    // Resellers to bill (all, or a single one for the admin "Bill now" action).
    let agencyQuery = admin
      .from("agency_accounts")
      .select("id, name, company_name, owner_email, owner_name, chargebee_customer_id, reseller_wholesale_price");
    if (onlyAgencyId) agencyQuery = agencyQuery.eq("id", onlyAgencyId);
    const { data: agencies, error: agErr } = await agencyQuery;
    if (agErr) throw agErr;

    // All live client practices in one query, then grouped per reseller.
    const { data: practices, error: prErr } = await admin
      .from("practices")
      .select("id, agency_id, subscription_status")
      .not("agency_id", "is", null)
      .in("subscription_status", ACTIVE_STATUSES);
    if (prErr) throw prErr;

    const activeByAgency = new Map<string, number>();
    for (const p of practices || []) {
      activeByAgency.set(p.agency_id, (activeByAgency.get(p.agency_id) || 0) + 1);
    }

    const results: Array<Record<string, unknown>> = [];
    let invoiced = 0;
    let suspended = 0;

    for (const a of agencies || []) {
      const activeCount = activeByAgency.get(a.id) || 0;
      if (activeCount === 0) {
        results.push({ agency_id: a.id, name: a.name, active: 0, skipped: "no_active_subaccounts" });
        continue;
      }
      // Per-reseller wholesale override (defaults to $297) → cents.
      const unitCents = Math.round((Number(a.reseller_wholesale_price) || WHOLESALE_CENTS / 100) * 100);
      const amountCents = activeCount * unitCents;

      if (dryRun) {
        results.push({ agency_id: a.id, name: a.name, active: activeCount, amount: amountCents / 100, dry_run: true });
        continue;
      }

      try {
        // 2) Ensure a Chargebee customer for the reseller.
        let customerId = a.chargebee_customer_id as string | null;
        if (!customerId) {
          if (!a.owner_email) {
            results.push({ agency_id: a.id, name: a.name, active: activeCount, error: "no_owner_email" });
            continue;
          }
          const parts = String(a.owner_name || "").trim().split(/\s+/);
          const created = await chargebeeRequest(cfg!, "/customers", "POST", {
            email: a.owner_email,
            first_name: parts[0] ?? "",
            last_name: parts.slice(1).join(" "),
            company: a.company_name || a.name || "",
          });
          customerId = created?.customer?.id ?? null;
          if (!customerId) {
            results.push({ agency_id: a.id, name: a.name, active: activeCount, error: "customer_create_failed" });
            continue;
          }
          await admin.from("agency_accounts").update({ chargebee_customer_id: customerId }).eq("id", a.id);
        }

        // 3) Create + auto-collect the wholesale invoice.
        const description = `CaseLift wholesale - ${activeCount} active subaccount${activeCount === 1 ? "" : "s"} @ $${(unitCents / 100).toFixed(0)}`;
        const inv = await chargebeeRequest(cfg!, "/invoices/create_for_charge_items_and_charges", "POST", {
          customer_id: customerId,
          auto_collection: "on",
          charges: { "0": { amount: amountCents, description } },
        });
        const status: string = inv?.invoice?.status ?? "unknown";
        const invoiceId: string | null = inv?.invoice?.id ?? null;
        invoiced++;

        // 4) Suspend on a failed/unpaid charge so the reseller's clients see the
        //    paused banner. 'paid' (and 'pending' from async gateways) pass.
        const paid = status === "paid" || status === "pending";
        if (!paid) {
          await admin.from("agency_accounts").update({ status: "suspended", active: false }).eq("id", a.id);
          suspended++;
        }
        results.push({
          agency_id: a.id,
          name: a.name,
          active: activeCount,
          amount: amountCents / 100,
          invoice_id: invoiceId,
          invoice_status: status,
          suspended: !paid,
        });
      } catch (e) {
        console.error(`bill-resellers: ${a.name} (${a.id}) failed:`, e);
        results.push({ agency_id: a.id, name: a.name, active: activeCount, error: String((e as Error)?.message ?? e) });
      }
    }

    return json({ ok: true, dry_run: dryRun, resellers: results.length, invoiced, suspended, results });
  } catch (e) {
    console.error("bill-resellers error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
