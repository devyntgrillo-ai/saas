import { reportEdgeError } from "../_shared/report-error.ts";
// chat-notify - fan-out for a new support-chat message. Practice → CaseLift: ping
// the #client-chats Slack channel (SLACK_CHAT_WEBHOOK_URL) + notify the super
// admin in-app. CaseLift → practice: notify the practice in-app. Unread counters
// and the channel preview are maintained by DB triggers, not here.
// Self-authenticates the caller; verify_jwt left default (the user's JWT is sent).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";
const APP_ORIGIN = "https://app.caselift.io";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { message_id } = await req.json().catch(() => ({}));
    if (!message_id) return json({ error: "message_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: msg } = await admin
      .from("support_messages")
      .select("id, practice_id, sender_type, sender_name, message, thread_parent_id")
      .eq("id", message_id)
      .maybeSingle();
    if (!msg) return json({ error: "message not found" }, 404);

    const { data: practice } = await admin.from("practices").select("name").eq("id", msg.practice_id).maybeSingle();
    const practiceName = practice?.name || "A practice";
    const preview = (msg.message || "").slice(0, 240);

    let slackSent = false;

    if (msg.sender_type === "practice") {
      // 1) Slack ping to the internal client-chats channel.
      const webhook = Deno.env.get("SLACK_CHAT_WEBHOOK_URL");
      if (webhook) {
        const res = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `💬 New message from *${practiceName}*`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `💬 *New message from ${practiceName}*\n>${preview || "(no text)"}\n<${APP_ORIGIN}/admin/chats?practice=${msg.practice_id}|View in CaseLift Admin →>`,
                },
              },
            ],
            unfurl_links: false,
          }),
        });
        slackSent = res.ok;
      }
      // 2) In-app notification for the super admin (scoped to their own practice + user).
      const { data: sa } = await admin.from("users").select("id, practice_id").eq("email", SUPER_ADMIN_EMAIL).maybeSingle();
      if (sa?.id && sa?.practice_id) {
        await admin.from("notifications").insert({
          practice_id: sa.practice_id,
          user_id: sa.id,
          type: "chat_message",
          title: `💬 ${practiceName} sent a message`,
          message: preview,
          link: `/admin/chats?practice=${msg.practice_id}`,
        });
      }
    } else if (msg.sender_type === "caselift_team") {
      // Notify the practice that the CaseLift team replied.
      await admin.from("notifications").insert({
        practice_id: msg.practice_id,
        user_id: null,
        type: "chat_message",
        title: "💬 CaseLift team replied to your message",
        message: preview,
        link: "/chat",
      });
    }

    return json({ ok: true, slack_sent: slackSent });
  } catch (e) {
    await reportEdgeError("chat-notify", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
