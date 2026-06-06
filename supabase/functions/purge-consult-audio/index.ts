// purge-consult-audio - daily cron. Deletes raw consult audio from the private
// consult-recordings bucket once it's older than the owning practice's retention
// window (practices.audio_retention_days, default 30), then nulls the path and
// stamps audio_deleted_at. Transcripts + all analysis are kept permanently.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { requireServiceRole } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "consult-recordings";
const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authErr = requireServiceRole(req);
  if (authErr) return authErr;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = Date.now();

    // Fetch every consult that still has retained audio + its practice's window,
    // then decide per-row (retention 0 = delete now; N = delete once older than N days).
    const { data: rows, error } = await admin
      .from("consults")
      .select("id, audio_storage_path, created_at, practice:practices(audio_retention_days)")
      .not("audio_storage_path", "is", null)
      .limit(2000);
    if (error) return json({ error: "Query failed", detail: error.message }, 500);

    let deleted = 0;
    let failed = 0;
    for (const r of rows ?? []) {
      const practice = Array.isArray(r.practice) ? r.practice[0] : r.practice;
      // Keep 0 ("immediately") distinct from null/unset (default 30).
      const days = practice?.audio_retention_days == null ? DEFAULT_RETENTION_DAYS : Number(practice.audio_retention_days);
      const cutoff = now - days * DAY_MS;
      if (new Date(r.created_at as string).getTime() >= cutoff) continue; // not old enough for this practice

      // Remove the file (ignore "already gone"); then null the path + stamp the time.
      await admin.storage.from(BUCKET).remove([r.audio_storage_path as string]).catch(() => {});
      const { error: upErr } = await admin
        .from("consults")
        .update({ audio_storage_path: null, audio_deleted_at: new Date().toISOString() })
        .eq("id", r.id);
      if (upErr) { failed++; continue; }
      deleted++;
    }

    console.log(`purge-consult-audio: deleted=${deleted} failed=${failed} scanned=${rows?.length ?? 0}`);
    return json({ deleted, failed, scanned: rows?.length ?? 0 });
  } catch (e) {
    console.error("purge-consult-audio error:", e);
    return json({ error: "Unexpected error.", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
