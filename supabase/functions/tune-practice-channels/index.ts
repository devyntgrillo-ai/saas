import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// tune-practice-channels - WEEKLY (cron). Per practice, recomputes channel reply
// rates from message_outcomes, derives a recommended sms/email/call mix and a
// human-readable insight, and stores it on practices.channel_performance.
// analyze-consult reads live reply rates already; this snapshot powers the TC
// dashboard card + a stable recommended mix. Service role.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const MIN_TOTAL = 15;   // need this many tracked messages before tuning
const MIN_CELL = 6;     // min sample for a channel / position to count
const BASE = { sms: 0.5, email: 0.3, call: 0.2 };

const chLabel = (c: string) => (c === "sms" ? "SMS" : c === "email" ? "email" : c === "call" ? "call reminder" : c);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: practices } = await admin.from("practices").select("id");
    let tuned = 0;

    for (const p of practices || []) {
      const { data: rows } = await admin
        .from("message_outcomes")
        .select("message_channel, message_position, replied")
        .eq("practice_id", p.id)
        .limit(5000);
      const outcomes = rows || [];
      if (outcomes.length < MIN_TOTAL) continue;

      // Per-channel reply rates.
      const ch: Record<string, { sent: number; replied: number; rate: number }> = {};
      const cell: Record<string, { sent: number; replied: number }> = {}; // position|channel
      for (const o of outcomes) {
        const c = o.message_channel || "unknown";
        ch[c] = ch[c] || { sent: 0, replied: 0, rate: 0 };
        ch[c].sent++; if (o.replied) ch[c].replied++;
        const key = `${o.message_position ?? "?"}|${c}`;
        cell[key] = cell[key] || { sent: 0, replied: 0 };
        cell[key].sent++; if (o.replied) cell[key].replied++;
      }
      for (const c of Object.keys(ch)) ch[c].rate = ch[c].sent ? ch[c].replied / ch[c].sent : 0;

      // Best channel (min sample) and recommended mix: blend base with reply-rate weights.
      const eligible = Object.entries(ch).filter(([c, s]) => ["sms", "email", "call"].includes(c) && s.sent >= MIN_CELL);
      const bestChannel = eligible.slice().sort((a, b) => b[1].rate - a[1].rate)[0]?.[0] || null;
      const totalRate = eligible.reduce((n, [, s]) => n + s.rate, 0) || 1;
      const mix: Record<string, number> = { sms: BASE.sms, email: BASE.email, call: BASE.call };
      if (eligible.length >= 2) {
        for (const [c, s] of eligible) {
          const perf = s.rate / totalRate; // performance share
          mix[c] = +(BASE[c as keyof typeof BASE] * 0.5 + perf * 0.5).toFixed(2);
        }
        const sum = mix.sms + mix.email + mix.call || 1;
        mix.sms = +(mix.sms / sum).toFixed(2); mix.email = +(mix.email / sum).toFixed(2); mix.call = +(mix.call / sum).toFixed(2);
      }

      // Top insight: best position|channel cell with enough sample.
      let top: { pos: string; ch: string; rate: number } | null = null;
      for (const [key, s] of Object.entries(cell)) {
        if (s.sent < MIN_CELL) continue;
        const rate = s.replied / s.sent;
        const [pos, c] = key.split("|");
        if (!top || rate > top.rate) top = { pos, ch: c, rate };
      }
      const topInsight = top
        ? `Your message #${top.pos} (${chLabel(top.ch)}) has a ${(top.rate * 100).toFixed(0)}% reply rate — your highest. We're weighting new sequences toward what's working.`
        : (bestChannel ? `${chLabel(bestChannel)} is your strongest channel (${(ch[bestChannel].rate * 100).toFixed(0)}% reply rate). New sequences lean into it.` : null);

      await admin.from("practices").update({
        channel_performance: {
          computed_at: new Date().toISOString(),
          total_tracked: outcomes.length,
          channels: ch,
          best_channel: bestChannel,
          recommended_mix: mix,
          top_insight: topInsight,
        },
      }).eq("id", p.id);
      tuned++;
    }

    return json({ ok: true, practices: (practices || []).length, tuned });
  } catch (e) {
    await reportEdgeError("tune-practice-channels", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
