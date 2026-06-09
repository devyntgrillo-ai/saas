# HIPAA Security Hardening — Consolidated Record

**Date:** 2026-06-09
**Application:** CaseLift (`saas`) · Supabase project ref `eymgqjeudrmeofytnwgs`
**Prepared for:** HIPAA compliance records
**Related detail docs:**
- `docs/compliance/2026-06-09-password-mfa-hardening.md`
- `docs/compliance/2026-06-09-encryption-infrastructure-security.md`

**Delivered as:** PR #3 (`password-security-mfa`) and PR #4 (`encryption-infra-security`, stacked on #3).

---

## Scope
Authentication, encryption, transport, and infrastructure controls supporting the
HIPAA Security Rule:
- §164.308(a)(5) — security awareness: password management & login monitoring
- §164.312(a)(2)(i) — unique user identification / authentication
- §164.312(a)(2)(iii) — automatic logoff
- §164.312(a)(2)(iv) — encryption & decryption (at rest)
- §164.312(d) — person/entity authentication (MFA)
- §164.312(e)(1) — transmission security (in transit)

---

## Controls Implemented

### A. Password Policy (§164.308(a)(5)(ii)(D))
- Minimum 8 characters; requires uppercase + lowercase + number.
- Common-password blocklist.
- Strength indicator + live requirements checklist in the UI.
- Enforced in signup and password-reset flows (client-side) and in Supabase
  (`minimum_password_length = 8`, `password_requirements = lower_upper_letters_digits`).

### B. Multi-Factor Authentication (§164.312(d))
- TOTP MFA enabled; setup in **Settings → Your Profile**.
- Flow: enroll → QR code → verify 6-digit code before activation → one-time backup codes.
- Disabling MFA requires password re-entry.
- Backup codes stored as SHA-256 hashes only (never plaintext).
- MFA enable/disable events written to the audit log.

### C. Session & Token Management (§164.312(a)(2)(iii))
- JWT access-token expiry: 1 hour.
- Refresh-token rotation enabled server-side; `autoRefreshToken` on in the client.
- Namespaced session storage key (`caselift-auth`).

### D. Failed-Login Logging (§164.308(a)(5)(ii)(C))
- Failed sign-ins recorded to `audit_logs`: action `auth.login_failure`,
  details `{ email, reason }`, `phi_accessed: false`.
- The attempted password is never logged.

### E. Secure Password Reset (§164.308(a)(5)(ii)(D))
- Supabase built-in email reset link; link expires after 1 hour.
- New password validated against the full policy.
- All other sessions invalidated after a reset.
- Audit events: `auth.password_reset_requested`, `auth.password_changed`.
- Enumeration-safe (identical response regardless of whether the email exists).

### F. Data Residency — US Region (policy)
- Startup check verifies the project is pinned to a US region; logs in dev,
  warns if non-US/undetermined.
- Note: Supabase cloud URLs do not encode the region; authoritative value is the
  dashboard, recorded via `VITE_SUPABASE_REGION`.

### G. Transmission Security — In Transit (§164.312(e)(1))
- Force HTTPS at the edge: 301 `http://` → `https://` redirect.
- `Content-Security-Policy: upgrade-insecure-requests`; HSTS (1 year, preload);
  plus `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`.
- Verified: every edge-function external API call uses HTTPS
  (Anthropic, OpenAI, Twilio, Mailgun, Helcim, Sikka). Zero insecure URLs.

### H. Frontend Secret Hygiene
- Verified: zero `service_role` references in `src/`. The frontend uses the anon
  (publishable) key only; the service-role key lives solely in edge-function secrets.

### I. Encryption at Rest (§164.312(a)(2)(iv))
- Statement of record: *"Supabase Pro plan includes AES-256 encryption at rest for
  all data, including the Postgres database and storage buckets."*

---

## Outstanding Dashboard / Operational Confirmations
These require access to the Supabase / Netlify dashboards and must be completed/recorded
to close out compliance:

1. **Supabase region** (Project Settings → General → Region) — confirm US East/West;
   set `VITE_SUPABASE_REGION` to match, in both local and Netlify env.
2. **Supabase Pro plan** active (Project Settings → Billing) — required for MFA and for
   the AES-256-at-rest guarantee.
3. **Netlify "Force HTTPS"** toggle enabled (alongside the redirect).
4. Enable **TOTP MFA** in the hosted Supabase project if not already (Auth → MFA).

## Known Limitations / Future Work
- **MFA backup-code redemption at sign-in** is not implemented (Supabase TOTP has no
  native recovery-code support). Hashes are stored, but redeeming a code when an
  authenticator is lost needs a server-side endpoint — tracked as future work.
- **Deploy note:** the new session `storageKey` signs existing users out once on the
  deploy that ships it.
- Invitation-acceptance password fields were out of scope; consider applying the same
  password policy there for consistency.

---

## Verification Matrix
| # | Control | Status |
|---|---------|--------|
| A | Password policy (8+, complexity, blocklist, strength) | ✅ Implemented |
| B | TOTP MFA (enroll/verify/backup/disable) | ✅ Implemented (dashboard enable pending) |
| C | 1h JWT, refresh rotation, autoRefresh | ✅ Verified/configured |
| D | Failed-login audit (no password) | ✅ Implemented |
| E | Secure reset (1h link, session invalidation, audit) | ✅ Implemented |
| F | US-region startup check | ✅ Implemented (dashboard value pending) |
| G | Force HTTPS + HSTS + CSP upgrade | ✅ Configured |
| G | Edge-function calls all HTTPS | ✅ Verified (0 insecure) |
| H | No service_role in frontend | ✅ Verified (0 matches) |
| I | AES-256 at rest documented | ✅ Documented (Pro-plan confirm pending) |
