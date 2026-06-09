/** App origin without trailing slash (APP_URL env or caller-provided app_origin). */
export function resolveAppOrigin(appOrigin?: string): string {
  return String(appOrigin || Deno.env.get("APP_URL") || "https://app.caselift.io").replace(/\/$/, "");
}

/** Post-auth landing page: Supabase establishes a session, user sets a password. */
export function acceptInviteRedirectUrl(appOrigin?: string): string {
  return `${resolveAppOrigin(appOrigin)}/accept-invite`;
}
