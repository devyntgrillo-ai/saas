// ============================================================================
// calculate-referral-payouts - monthly referral payout snapshot (cron, service role).
//
// For the month being covered (defaults to the first day of the current month,
// overridable via the `month` body param for backfills), inserts one `pending`
// referral_payouts row per active referred practice, crediting its referrer.
//
// Business rules:
//   - The referred practice must have subscription_status = 'active'.
//   - The referring practice must ALSO be on an active subscription to receive
//     payments (per the program's small print). Inactive referrers are skipped.
//   - Reseller-onboarded practices (agency_id set) don't earn referral payouts.
//   - Idempotent: a unique (referrer, referred, month) constraint + upsert means
//     re-running for the same month never double-pays.
//
// A super-admin reviews the resulting `pending` rows in /admin/referrals and
// marks them paid manually (Stripe/ACH automation can layer on later).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const AMOUNT = 250;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// First day of the current month, in UTC, as YYYY-MM-DD.
function firstOfThisMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    let month = firstOfThisMonth();
    try {
      const body = await req.json();
      if (body?.month && /^\d{4}-\d{2}-\d{2}$/.test(body.month)) month = body.month;
    } catch {
      // no/invalid body - use the default month
    }

    // Active referred practices: signed up via a referral and currently paying.
    const { data: referred, error } = await admin
      .from("practices")
      .select("id, referred_by_practice_id, subscription_status")
      .not("referred_by_practice_id", "is", null)
      .eq("subscription_status", "active");
    if (error) throw error;

    const referrals = referred || [];
    if (referrals.length === 0) {
      return json({ ok: true, month, created: 0, skipped_inactive_referrer: 0 });
    }

    // Only credit referrers who are themselves on an active subscription.
    const referrerIds = [...new Set(referrals.map((r) => r.referred_by_practice_id))];
    const { data: referrers } = await admin
      .from("practices")
      .select("id, subscription_status")
      .in("id", referrerIds);
    const activeReferrer = new Set(
      (referrers || []).filter((p) => p.subscription_status === "active").map((p) => p.id),
    );

    const rows: Array<Record<string, unknown>> = [];
    let skippedInactiveReferrer = 0;
    for (const r of referrals) {
      if (!activeReferrer.has(r.referred_by_practice_id)) {
        skippedInactiveReferrer++;
        continue;
      }
      rows.push({
        referring_practice_id: r.referred_by_practice_id,
        referred_practice_id: r.id,
        month,
        amount: AMOUNT,
        status: "pending",
      });
    }

    let created = 0;
    if (rows.length) {
      // Upsert on the (referrer, referred, month) unique key - re-running is a no-op.
      const { data, error: upErr } = await admin
        .from("referral_payouts")
        .upsert(rows, {
          onConflict: "referring_practice_id,referred_practice_id,month",
          ignoreDuplicates: true,
        })
        .select("id");
      if (upErr) throw upErr;
      created = data?.length ?? 0;
    }

    return json({ ok: true, month, created, skipped_inactive_referrer: skippedInactiveReferrer });
  } catch (e) {
    console.error("calculate-referral-payouts error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
