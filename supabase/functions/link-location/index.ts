import { reportEdgeError } from "../_shared/report-error.ts";
// ============================================================================
// link-location — multi-location signup. When an owner clicks "Add another
// location" in Billing, they're sent to /signup?parent_practice=<id>. After the
// new account + practice are created, the client calls this with the parent
// practice id. We record a practice_members row for the NEW user against the
// parent practice, so their account switcher lists both locations.
//
// The user's own (new) practice is already their home (users.practice_id); the
// parent membership is what makes them multi-location. Inserts run with the
// service role because RLS deliberately blocks users from self-inserting
// memberships (that would let anyone grant themselves read access to any
// practice). The parent practice id acts as an unguessable capability passed
// from the authenticated billing page.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // Caller identity from their JWT.
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const parentPracticeId: string | undefined = body.parent_practice_id;
    const newPracticeId: string | undefined = body.new_practice_id;
    if (!parentPracticeId) return json({ error: "parent_practice_id is required" }, 400);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // Validate the parent practice exists before linking.
    const { data: parent, error: pErr } = await admin
      .from("practices").select("id").eq("id", parentPracticeId).maybeSingle();
    if (pErr) throw pErr;
    if (!parent) return json({ error: "Parent practice not found" }, 404);

    // Link this user to the parent practice (and, defensively, to their own new
    // practice) so the switcher lists every location they can access.
    const rows = [{ practice_id: parentPracticeId, user_id: user.id, role: "member" }];
    if (newPracticeId) rows.push({ practice_id: newPracticeId, user_id: user.id, role: "member" });

    const { error: insErr } = await admin
      .from("practice_members")
      .upsert(rows, { onConflict: "practice_id,user_id", ignoreDuplicates: true });
    if (insErr) throw insErr;

    return json({ ok: true, linked: rows.length });
  } catch (e) {
    await reportEdgeError("link-location", e);
    console.error("link-location error:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
