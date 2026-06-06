// get-recording-url - returns a short-lived signed URL for a consult's audio so
// the detail page can play it back. Authorization is enforced by RLS: we look up
// the consult with the CALLER's token, and only if they can see it do we mint a
// signed URL (with the service role) for the private consult-recordings bucket.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKET = "consult-recordings";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing Authorization header" }, 401);

    const body = await req.json().catch(() => ({}));
    const consultId = body?.consult_id;
    if (!consultId) return json({ error: "consult_id is required" }, 400);

    // Caller-scoped client: a service-role bearer gets full access; otherwise the
    // user's JWT, so RLS decides whether they may see this consult.
    const isServiceRole = token === SERVICE_KEY;
    const scoped = isServiceRole
      ? createClient(SUPABASE_URL, SERVICE_KEY)
      : createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });

    if (!isServiceRole) {
      // Validate the specific bearer token (more robust than reading a session).
      const { data: { user } } = await scoped.auth.getUser(token);
      if (!user) return json({ error: "Unauthorized" }, 401);
    }

    const { data: consult } = await scoped
      .from("consults")
      .select("id, audio_storage_path")
      .eq("id", consultId)
      .maybeSingle();

    // Null when the consult doesn't exist OR RLS hides it from this caller.
    if (!consult) return json({ error: "Not found" }, 404);
    if (!consult.audio_storage_path) return json({ error: "No recording is available for this consult." }, 404);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: signed, error: sErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(consult.audio_storage_path as string, 3600);
    if (sErr || !signed?.signedUrl) {
      return json({ error: "Could not load the recording.", detail: sErr?.message }, 500);
    }

    return json({ url: signed.signedUrl });
  } catch (e) {
    console.error("get-recording-url error:", e);
    return json({ error: "Unexpected error.", detail: String((e as Error)?.message ?? e) }, 500);
  }
});
