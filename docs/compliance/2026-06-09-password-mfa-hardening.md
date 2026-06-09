# HIPAA Security Hardening — Password Policy, MFA, Session & Audit Controls

**Date:** 2026-06-09
**Application:** CaseLift (`saas`)
**Scope:** Authentication security controls supporting HIPAA Security Rule safeguards
(§164.308(a)(5) — password management & login monitoring; §164.312(a)(2)(i) — unique
user ID / authentication; §164.312(d) — person/entity authentication).

---

## 1. Password Requirements (Access Control / §164.308(a)(5)(ii)(D))
Enforced in both the signup and password-reset flows:
- Minimum **8 characters**
- At least **1 uppercase**, **1 lowercase**, and **1 number**
- **Common-password blocklist** (basic list of trivially-guessed passwords)
- **Password strength indicator** + live requirements checklist shown to the user

**Enforcement points:**
- Client-side: `src/lib/passwordPolicy.js`, surfaced via `src/components/PasswordField.jsx`
- Applied in: `src/pages/Signup.jsx`, `src/pages/Onboarding.jsx` (live signup path),
  `src/pages/ResetPassword.jsx`
- Server-side (authoritative): `supabase/config.toml` →
  `minimum_password_length = 8`, `password_requirements = "lower_upper_letters_digits"`

## 2. Multi-Factor Authentication (Person/Entity Authentication / §164.312(d))
- **TOTP MFA enabled** in Supabase (`supabase/config.toml` → `[auth.mfa.totp]`
  `enroll_enabled = true`, `verify_enabled = true`).
- User-facing setup in **Settings → Your Profile** (`src/components/MfaSetup.jsx`):
  - "Enable Two-Factor Authentication" button
  - QR code + manual secret for authenticator app
  - Verification with a 6-digit code before activation (`mfa.enroll` → `mfa.challenge` → `mfa.verify`)
  - One-time **backup codes** displayed after setup (only SHA-256 hashes stored, never plaintext)
  - "Disable MFA" requires **password re-entry** (re-authentication)
- MFA enable/disable events recorded to the audit log.

**Dashboard dependency:** TOTP MFA must also be enabled in the hosted Supabase
project (Auth → MFA); it is a Pro-plan feature. The UI shows a clear message if not yet enabled.

## 3. JWT Token Expiry & Refresh Rotation (§164.312(a)(2)(iii) — automatic logoff)
- **JWT access-token expiry: 1 hour** (`config.toml` → `jwt_expiry = 3600`).
- **Refresh-token rotation enabled** server-side (`config.toml` →
  `enable_refresh_token_rotation = true`); each refresh issues a new token.
- Client uses `autoRefreshToken: true` (`src/lib/supabase.js`) — confirmed and documented.

## 4. Failed-Login Logging (Login Monitoring / §164.308(a)(5)(ii)(C))
- Failed `signInWithPassword` attempts are logged to `audit_logs` in
  `src/context/AuthContext.jsx` via the `log-audit` edge function:
  - `action: auth.login_failure`
  - `details: { email, reason }`
  - `phi_accessed: false`
- **The attempted password is never logged.**

## 5. Secure Password Reset (§164.308(a)(5)(ii)(D))
- Uses Supabase's **built-in email reset link** (`resetPasswordForEmail`) —
  `src/pages/ForgotPassword.jsx`.
- **Reset links expire after 1 hour** (`config.toml` → `otp_expiry = 3600`).
- After reset, **all other sessions are invalidated** (`signOut({ scope: 'others' })`) —
  `src/pages/ResetPassword.jsx`.
- New password is validated against the full password policy.
- Audit events logged: `auth.password_reset_requested` (on request),
  `auth.password_changed` (on completion).
- Forgot-password flow is account-enumeration-safe (identical response regardless of
  whether the email is registered).

---

## Files Added
- `src/lib/passwordPolicy.js`
- `src/components/PasswordField.jsx`
- `src/pages/ForgotPassword.jsx`
- `src/pages/ResetPassword.jsx`
- `src/components/MfaSetup.jsx`
- `src/lib/mfa.js`

## Files Modified
- `src/pages/Signup.jsx`, `src/pages/Onboarding.jsx` — password policy enforcement
- `src/pages/Login.jsx` — "Forgot password?" link
- `src/App.jsx` — `/forgot-password`, `/reset-password` routes
- `src/components/UserProfilePanel.jsx` — MFA setup section
- `src/context/AuthContext.jsx` — failed-login audit detail
- `src/lib/audit.js` — MFA audit wrappers
- `src/lib/supabase.js` — token-refresh documentation
- `supabase/config.toml` — password length/complexity, TOTP MFA enablement

## Outstanding / Operational Items
- **Hosted Supabase dashboard** must mirror `config.toml`: enable TOTP MFA, and confirm
  JWT expiry (1h), refresh-token rotation, OTP expiry (1h), and password rules.
- **Backup-code redemption at sign-in** (when an authenticator is lost) is *not* implemented;
  Supabase TOTP does not support it natively. Backup-code hashes are stored, but redeeming
  one requires a server-side verification endpoint (edge function) — tracked as future work.
- Invitation-acceptance password fields (`AcceptInvite.jsx`, `AcceptInvitation.jsx`) were not
  in the original scope; consider applying the same password policy there for consistency.
