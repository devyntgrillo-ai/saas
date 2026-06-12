// Minimal Expo Push API sender. Sends to ExponentPushToken[...] tokens via
// https://exp.host/--/api/v2/push/send in batches of 100 (the API limit).
//
// Note: actual delivery to iOS devices additionally requires an APNs key
// configured in EAS credentials; this just hands messages to Expo's service.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100;

export type ExpoPushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type ExpoPushResult = {
  sent: number;
  invalidTokens: string[];
  errors: unknown[];
};

export async function sendExpoPush(
  tokens: string[],
  msg: ExpoPushMessage,
): Promise<ExpoPushResult> {
  const valid = (tokens || []).filter(
    (t) => typeof t === "string" && t.startsWith("ExponentPushToken"),
  );
  const result: ExpoPushResult = { sent: 0, invalidTokens: [], errors: [] };
  if (!valid.length) return result;

  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);
    const messages = batch.map((to) => ({
      to,
      title: msg.title,
      body: msg.body,
      data: msg.data || {},
      sound: "default",
    }));
    try {
      const r = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
      });
      // deno-lint-ignore no-explicit-any
      const jr: any = await r.json().catch(() => null);
      if (!r.ok) {
        result.errors.push(jr || { status: r.status });
        continue;
      }
      // Per-ticket inspection: collect DeviceNotRegistered tokens so the caller
      // can prune them from user_devices.
      const tickets = Array.isArray(jr?.data) ? jr.data : [];
      tickets.forEach((ticket: { status?: string; details?: { error?: string } }, idx: number) => {
        if (ticket?.status === "error" && ticket?.details?.error === "DeviceNotRegistered") {
          result.invalidTokens.push(batch[idx]);
        } else if (ticket?.status === "ok") {
          result.sent += 1;
        }
      });
    } catch (e) {
      result.errors.push(String((e as Error)?.message ?? e));
    }
  }
  return result;
}
