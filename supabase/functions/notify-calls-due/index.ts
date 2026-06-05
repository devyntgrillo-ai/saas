// ============================================================================
// notify-calls-due - daily 8am cron. Finds follow-up calls due today (sequence
// messages with type='call' scheduled for today) and fans each out to staff via
// notify-staff (event_name 'call_due_today'). Service-role; verify_jwt=false.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { requireServiceRole } from "../_shared/auth.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authErr = requireServiceRole(req);
  if (authErr) return authErr;
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const today = new Date().toISOString().slice(0, 10);
    const { data: due } = await admin
      .from("messages")
      .select("id, consult_id, practice_id, scheduled_for, body, type, status, consult:consults(patient_name)")
      .eq("type", "call")
      .in("status", ["draft", "scheduled", "pending"])
      .gte("scheduled_for", `${today}T00:00:00Z`)
      .lte("scheduled_for", `${today}T23:59:59Z`);

    const calls = due || [];
    // Group due calls per practice -> one "daily list" notification each.
    const byPractice = new Map<string, string[]>();
    for (const m of calls) {
      const pid = m.practice_id;
      if (!pid) continue;
      // deno-lint-ignore no-explicit-any
      const nm = (m as any).consult?.patient_name || "A patient";
      const arr = byPractice.get(pid) || [];
      arr.push(nm);
      byPractice.set(pid, arr);
    }

    let fired = 0;
    for (const [pid, names] of byPractice) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-staff`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            practice_id: pid,
            event_name: "daily_calls_due",
            payload: { count: names.length, patient_names: names },
          }),
        });
        fired++;
      } catch (e) {
        console.error("notify-calls-due: notify-staff failed", e);
      }
    }

    return json({ ok: true, due: calls.length, practices_notified: fired });
  } catch (e) {
    console.error("notify-calls-due error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
