// Auth/invite redirect origins. Delegates to appUrl.ts, which IGNORES a
// caller-supplied localhost/dev origin in favour of the canonical production URL
//, so invites emailed from a dev server still point at production. (The previous
// implementation trusted app_origin first, which sent real invitees to localhost.)
import { appBaseUrl } from "./appUrl.ts";

/** Trusted app origin without trailing slash. The argument is ignored when it is
 *  a localhost/dev origin; production callers get the canonical URL regardless. */
export function resolveAppOrigin(_appOrigin?: string): string {
  return appBaseUrl();
}

/** Post-auth landing page: Supabase establishes a session, user sets a password. */
export function acceptInviteRedirectUrl(_appOrigin?: string): string {
  return `${appBaseUrl()}/accept-invite`;
}
