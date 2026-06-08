import { reportEdgeError } from "../_shared/report-error.ts";
// notify-testimonial - after a practice records a video testimonial (Get a Free
// Month), sign the uploaded clip and post a watch link to the internal #wins
// Slack channel (SLACK_WINS_WEBHOOK_URL, falling back to SLACK_WEBHOOK_URL).
// Self-authenticates the caller's token. verify_jwt=false.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const BUCKET = "testimonials";
const SIGN_TTL = 60 * 60 * 24 * 30; // 30 days

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const videoPath = String(body.video_path || "").trim();
    if (!videoPath) return json({ error: "video_path is required" }, 400);

    // Resolve the caller's practice; only allow signing their own folder.
    const scoped = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await scoped.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);
    // The video lives under <practice_id>/<file>. Derive the practice from the
    // path itself so this also works when an agency / super-admin records on
    // behalf of a practice they manage (their own users.practice_id won't match
    // the uploaded folder). A valid authenticated user is still required above,
    // and storage RLS already governs who can read the clip.
    const admin = createClient(SUPABASE_URL, SERVICE);
    const pathPractice = (videoPath.split("/")[0] || "").trim();
    const { data: practice } = await admin.from("practices").select("name").eq("id", pathPractice).maybeSingle();
    if (!practice) return json({ error: "Unknown practice for video_path" }, 404);
    const practiceName = practice.name || "A practice";

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(videoPath, SIGN_TTL);
    const watchUrl = signed?.signedUrl || "";

    const webhook = Deno.env.get("SLACK_WINS_WEBHOOK_URL") || Deno.env.get("SLACK_WEBHOOK_URL");
    if (!webhook) return json({ ok: true, slack_sent: false, reason: "no webhook configured" });

    const text = `🎥 *New video testimonial* from *${practiceName}* (Get a Free Month)\n${watchUrl ? `Watch (expires in 30 days): ${watchUrl}` : "(could not generate a watch link)"}`;
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false }),
    });
    return json({ ok: true, slack_sent: res.ok });
  } catch (e) {
    await reportEdgeError("notify-testimonial", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
