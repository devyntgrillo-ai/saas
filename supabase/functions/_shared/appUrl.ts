// Canonical production app URL for auth/invite redirect links.
//
// Invite flows pass the INVITER's browser origin (window.location.origin) as
// app_origin / redirect_to. During development that's http://localhost:5173,
// which would send real invitees to localhost. We therefore ignore the client
// origin entirely for redirects and always build links from a server-controlled
// canonical URL (APP_URL secret, or the production default). This also closes an
// open-redirect vector, invitees can never be sent to an attacker-supplied host.
const DEFAULT_APP_URL = "https://app.caselift.io";

/** The trusted production app origin, e.g. "https://app.caselift.io". */
export function appBaseUrl(): string {
  return (Deno.env.get("APP_URL") || DEFAULT_APP_URL).replace(/\/$/, "");
}

/**
 * Build a redirect URL on the trusted origin. Keeps only the PATH from a
 * client-supplied candidate (so /accept-invite, /invite/:token etc. survive),
 * but the origin is always the canonical app URL.
 */
export function safeRedirect(candidate: string | undefined | null, defaultPath: string): string {
  const origin = appBaseUrl();
  let path = defaultPath;
  if (candidate) {
    try {
      const u = new URL(candidate);
      path = `${u.pathname}${u.search}` || defaultPath;
    } catch {
      // Not a full URL, treat it as a path if it looks like one.
      if (candidate.startsWith("/")) path = candidate;
    }
  }
  if (!path.startsWith("/")) path = `/${path}`;
  return `${origin}${path}`;
}
