// Auth/invite redirect origins. Delegates to appUrl.ts, which IGNORES a
// caller-supplied localhost/dev origin in favour of the canonical production URL
// — so invites emailed from a dev server still point at production.
import { appBaseUrl } from "./appUrl.ts";

/** Trusted app origin without trailing slash. */
export function resolveAppOrigin(): string {
  return appBaseUrl();
}

/** Post-auth landing page: Supabase establishes a session, user sets a password. */
export function acceptInviteRedirectUrl(query?: Record<string, string>): string {
  const base = `${appBaseUrl()}/accept-invite`;
  if (!query || !Object.keys(query).length) return base;
  return `${base}?${new URLSearchParams(query)}`;
}
