import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// sync-appointments - pull consult appointments from Sikka into pms_appointments.
// Only runs for practices that approved their consult sync rules (pms_sync_approved_at).
// Uses configured history/forward year windows and AI-approved cluster matching.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { getAppCreds } from "../_shared/sikka.ts";
import {
  clampYears,
  isSyncApproved,
  jitUpsertPatientsFromAppointments,
  mapAppointmentRow,
  matchesSyncRules,
  PRACTICE_SYNC_COLS,
  syncMatchedAppointments,
  upsertAppointments,
  type PmsSyncPracticeRow,
  type PmsSyncRules,
} from "../_shared/pms-sync.ts";
import { ensureFreshToken, sikkaGet, SIKKA_APPOINTMENTS_PATH, unwrapList, normalizeTreatment } from "../_shared/sikka.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function postSlackInline(text: string) {
  const url = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  } catch (e) {
    console.error("Slack post failed:", e);
  }
}

// Incremental window: small backfill overlap + full forward look from practice settings.
async function fetchIncrementalAppointments(requestKey: string, officeId: string, forwardYears: number) {
  const startdate = ymd(new Date(Date.now() - 14 * 86400000));
  const end = new Date();
  end.setFullYear(end.getFullYear() + clampYears(forwardYears));
  const enddate = ymd(end);
  const data = await sikkaGet(SIKKA_APPOINTMENTS_PATH, requestKey, { office_id: officeId, startdate, enddate });
  return unwrapList(data, "appointments");
}

const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);

// deno-lint-ignore no-explicit-any
async function syncOnePractice(admin: any, practice: PmsSyncPracticeRow) {
  if (!practice.sikka_practice_id) throw new Error("missing_office_id");
  if (!isSyncApproved(practice)) return 0;

  const rules = practice.pms_sync_rules as PmsSyncRules | null;
  if (!rules?.clusters?.length) return 0;

  const requestKey = await ensureFreshToken(admin, practice);
  const forwardYears = clampYears(practice.pms_forward_years ?? rules.forward_years ?? 1);
  const raw = await fetchIncrementalAppointments(requestKey, practice.sikka_practice_id, forwardYears);

  const rows = [];
  // deno-lint-ignore no-explicit-any
  const matchedRaw: any[] = [];
  for (const a of raw) {
    const { match, ruleId } = matchesSyncRules(rules, a);
    if (!match) continue;
    const row = mapAppointmentRow(a, practice.id, ruleId, rules);
    if (!row.pms_appointment_id) continue;
    rows.push(row);
    matchedRaw.push(a);
  }

  if (rows.length) {
    await upsertAppointments(admin, rows);
    await jitUpsertPatientsFromAppointments(admin, practice.id, practice.sikka_practice_id, matchedRaw);
  }

  await admin.from("practices").update({ pms_last_synced_at: new Date().toISOString(), sikka_connected: true }).eq("id", practice.id);

  // PMS close-guard (treatment/procedure appointments still close open consults).
  try {
    // deno-lint-ignore no-explicit-any
    const treat = (raw as any[]).filter((a) => /treatment|procedure/i.test(a.appointment_type || a.type || "") || /complete/i.test(a.status || ""));
    if (treat.length) {
      const { data: openConsults } = await admin
        .from("consults")
        .select("id, patient_phone, patient_name")
        .eq("practice_id", practice.id)
        .not("outcome", "in", "(accepted,not_converting,closed_won)");
      for (const a of treat) {
        const phone = last10(a.patient?.mobile_phone || a.patient?.phone || a.patient_phone || "");
        if (phone.length < 10) continue;
        // deno-lint-ignore no-explicit-any
        const match = (openConsults || []).find((c: any) => last10(c.patient_phone || "") === phone);
        if (!match) continue;

        const value = Number(
          a.treatment_value ?? a.production ?? a.amount ?? a.case_value ?? a.treatment_amount ?? 0,
        ) || null;

        const { count: sentCount } = await admin
          .from("messages").select("id", { count: "exact", head: true })
          .eq("consult_id", match.id).eq("status", "sent");
        const { data: convs } = await admin.from("conversations").select("id").eq("consult_id", match.id);
        // deno-lint-ignore no-explicit-any
        const convIds = (convs || []).map((c: any) => c.id);
        let replied = false;
        if (convIds.length) {
          const { count: inCount } = await admin
            .from("conversation_messages").select("id", { count: "exact", head: true })
            .eq("direction", "inbound").in("conversation_id", convIds);
          replied = (inCount || 0) > 0;
        }
        const status = replied ? "caselift_recovered" : (sentCount || 0) > 0 ? "caselift_assisted" : "practice_direct";

        // deno-lint-ignore no-explicit-any
        const patch: Record<string, any> = {
          outcome: "closed_won",
          sequence_cancelled_at: new Date().toISOString(),
          sequence_cancelled_reason: "Auto-closed by PMS sync",
          attribution_status: status,
          attribution_confirmed_at: new Date().toISOString(),
          attribution_source: "pms_sync",
          attribution_model: status === "practice_direct" ? "practice_recovered" : "caselift_recovered",
        };
        if (value != null) {
          patch.case_value = value;
          patch.tx_plan_value = value;
          patch.tx_plan_value_source = "pms";
        }
        const tt = normalizeTreatment(a.appointment_type ?? a.type ?? a.description ?? a.treatment_type);
        if (tt) patch.treatment_type = tt;

        const upd = await admin.from("consults").update(patch).eq("id", match.id);
        if (upd.error) {
          await admin.from("consults").update({
            outcome: "closed_won",
            sequence_cancelled_at: patch.sequence_cancelled_at,
            sequence_cancelled_reason: patch.sequence_cancelled_reason,
            ...(value != null ? { case_value: value } : {}),
          }).eq("id", match.id);
        }
        await admin.from("messages").update({ status: "cancelled" })
          .eq("consult_id", match.id).in("status", ["draft", "scheduled", "pending"]);

        await admin.from("attribution_events").insert({
          consult_id: match.id, practice_id: practice.id,
          event_type: "treatment_accepted", source: "pms",
        }).then(() => {}, () => {});

        await admin.from("audit_logs").insert({
          practice_id: practice.id, action: "consult.treatment_accepted",
          resource_type: "consult", resource_id: match.id,
        }).then(() => {}, () => {});

        admin.functions.invoke("record-win", { body: { consult_id: match.id, practice_id: practice.id, source: "pms_webhook" } })
          .then(() => {}, (e: unknown) => console.error("record-win invoke failed:", e));

        if (status !== "practice_direct") {
          const name = [a.patient?.first_name, a.patient?.last_name].filter(Boolean).join(" ")
            || match.patient_name || "A patient";
          const valStr = value != null ? `$${value.toLocaleString()}` : "value pending";
          await postSlackInline(
            `🟢 Treatment accepted - ${name} - ${valStr} - Attributed to CaseLift (${status === "caselift_recovered" ? "Recovered" : "Assisted"})`,
          );
        }
      }
    }
  } catch (e) {
    console.error("PMS close-guard failed:", e);
  }

  return rows.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    getAppCreds();
  } catch {
    return json({ error: "PMS sync unavailable - Sikka app credentials are not set.", code: "sikka_not_configured" }, 503);
  }

  try {
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const isService = token && token === SERVICE_KEY;

    let practices: PmsSyncPracticeRow[] = [];
    if (isService && body.sync_all) {
      const { data } = await admin
        .from("practices")
        .select(PRACTICE_SYNC_COLS)
        .eq("sikka_connected", true)
        .not("sikka_refresh_token", "is", null)
        .not("pms_sync_approved_at", "is", null);
      practices = (data || []) as PmsSyncPracticeRow[];
    } else {
      let practiceId: string | null = body.practice_id ?? null;
      if (!isService) {
        const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (!user) return json({ error: "Unauthorized" }, 401);
        const { data: prof } = await userClient.from("users").select("practice_id").eq("id", user.id).maybeSingle();
        practiceId = prof?.practice_id ?? null;
      }
      if (!practiceId) return json({ error: "No practice in context." }, 400);
      const { data: pr } = await admin.from("practices").select(PRACTICE_SYNC_COLS).eq("id", practiceId).maybeSingle();
      if (!pr) return json({ error: "Practice not found." }, 404);
      if (!pr.sikka_refresh_token) return json({ error: "This practice hasn't connected to Sikka yet.", code: "not_linked" }, 409);
      if (!isSyncApproved(pr as PmsSyncPracticeRow)) {
        return json({ error: "Consult sync not approved yet. Complete setup in PMS settings.", code: "not_approved" }, 409);
      }
      practices = [pr as PmsSyncPracticeRow];
    }

    // Full backfill path (service role only, e.g. after re-approval).
    if (isService && body.full_backfill && practices.length === 1) {
      const pr = practices[0];
      const rules = pr.pms_sync_rules as PmsSyncRules;
      if (rules) {
        const result = await syncMatchedAppointments(admin, pr, rules);
        return json({ synced: result.synced, patients: result.patients, scanned: result.scanned, full_backfill: true });
      }
    }

    let synced = 0;
    const errors: { practice_id: string; error: string }[] = [];
    const skipped: string[] = [];
    for (const p of practices) {
      if (!isSyncApproved(p)) {
        skipped.push(p.id);
        continue;
      }
      try {
        synced += await syncOnePractice(admin, p);
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        console.error(`sync-appointments: practice ${p.id} failed:`, msg);
        errors.push({ practice_id: p.id, error: msg });
      }
    }

    if (practices.length === 1 && errors.length === 1) {
      const detail = errors[0].error;
      const code = detail === "sikka_not_connected" ? "not_linked" : "sikka_error";
      return json({ error: "PMS sync unavailable - check your Sikka connection.", code, detail }, 502);
    }
    return json({ synced, practices: practices.length, skipped, errors });
  } catch (e) {
    await reportEdgeError("sync-appointments", e);
    console.error("sync-appointments error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
