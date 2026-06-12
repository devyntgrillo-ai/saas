// Per-user recipient resolution for staff notifications.
//
// Replaces the old "single practice contact" model: given a practice + event,
// returns every member's resolved delivery prefs (email / sms / push) from
// public.user_notification_settings, plus their registered push tokens from
// public.user_devices. Channels are merged as DEFAULTS[event] -> the user's
// saved per-event prefs. Slack is intentionally NOT per-user (it stays a
// CaseLift-internal global channel, handled by the caller).

// Per-event channel defaults, mirroring the Settings UI. Used when a user has
// not explicitly toggled a given channel for an event.
export const EVENT_DEFAULTS: Record<string, { email: boolean; sms: boolean; push: boolean }> = {
  patient_replied: { email: true, sms: true, push: true },
  case_converted: { email: true, sms: true, push: true },
  daily_calls_due: { email: true, sms: false, push: true },
  low_recording_rate: { email: true, sms: false, push: true },
};

export type Recipient = {
  userId: string;
  email: string | null;
  sms: string | null;
  pushTokens: string[];
  prefs: { email: boolean; sms: boolean; push: boolean };
};

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function resolvePracticeRecipients(
  admin: Admin,
  practiceId: string,
  eventName: string,
): Promise<Recipient[]> {
  // Members = users whose home practice is this one, unioned with practice_members.
  const [{ data: directUsers }, { data: members }] = await Promise.all([
    admin.from("users").select("id").eq("practice_id", practiceId),
    admin.from("practice_members").select("user_id").eq("practice_id", practiceId),
  ]);
  const ids = new Set<string>();
  for (const u of directUsers || []) if (u.id) ids.add(u.id as string);
  for (const m of members || []) if (m.user_id) ids.add(m.user_id as string);
  if (!ids.size) return [];
  const idList = [...ids];

  const [{ data: settings }, { data: devices }] = await Promise.all([
    admin.from("user_notification_settings").select("*").in("user_id", idList),
    admin.from("user_devices").select("user_id, expo_push_token").in("user_id", idList),
  ]);

  return buildRecipients(idList, settings || [], devices || [], eventName);
}

// Emails of members who have the weekly digest enabled (per-user). Callers fall
// back to the practice contact when this is empty, preserving prior behavior.
export async function resolveDigestEmails(admin: Admin, practiceId: string): Promise<string[]> {
  const [{ data: directUsers }, { data: members }] = await Promise.all([
    admin.from("users").select("id").eq("practice_id", practiceId),
    admin.from("practice_members").select("user_id").eq("practice_id", practiceId),
  ]);
  const ids = new Set<string>();
  for (const u of directUsers || []) if (u.id) ids.add(u.id as string);
  for (const m of members || []) if (m.user_id) ids.add(m.user_id as string);
  if (!ids.size) return [];
  const { data: settings } = await admin
    .from("user_notification_settings")
    .select("notify_email_address, weekly_digest_enabled")
    .in("user_id", [...ids]);
  return (settings || [])
    // deno-lint-ignore no-explicit-any
    .filter((s: any) => s.weekly_digest_enabled && s.notify_email_address && /@/.test(s.notify_email_address))
    // deno-lint-ignore no-explicit-any
    .map((s: any) => s.notify_email_address as string);
}

// deno-lint-ignore no-explicit-any
function buildRecipients(idList: string[], settings: any[], devices: any[], eventName: string): Recipient[] {
  // deno-lint-ignore no-explicit-any
  const settingsByUser = new Map<string, any>((settings || []).map((s: any) => [s.user_id, s]));
  const tokensByUser = new Map<string, string[]>();
  for (const d of devices || []) {
    const arr = tokensByUser.get(d.user_id) || [];
    arr.push(d.expo_push_token);
    tokensByUser.set(d.user_id, arr);
  }
  const def = EVENT_DEFAULTS[eventName] || { email: false, sms: false, push: false };
  const recipients: Recipient[] = [];
  for (const uid of idList) {
    const s = settingsByUser.get(uid);
    if (!s) continue; // No per-user settings row yet → not a configured recipient.
    const evp = (s.notification_prefs || {})[eventName] || {};
    recipients.push({
      userId: uid,
      email: s.notify_email_address || null,
      sms: s.notify_sms_number || null,
      pushTokens: tokensByUser.get(uid) || [],
      prefs: {
        email: evp.email ?? def.email,
        sms: evp.sms ?? def.sms,
        // A user can hard-disable all push via notify_push regardless of per-event.
        push: (evp.push ?? def.push) && (s.notify_push ?? true),
      },
    });
  }
  return recipients;
}
