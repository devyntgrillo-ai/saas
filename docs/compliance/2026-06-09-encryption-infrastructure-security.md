# HIPAA Encryption & Infrastructure Security Verification

**Date:** 2026-06-09
**Application:** CaseLift (`saas`)
**Supabase project ref:** `eymgqjeudrmeofytnwgs`
**Scope:** Encryption (in transit + at rest), data residency, and frontend secret
hygiene supporting HIPAA Security Rule §164.312(e)(1) (transmission security) and
§164.312(a)(2)(iv) (encryption/decryption).

---

## 1. Data Residency — US Region
**Policy:** All PHI is hosted in a US region.

**How it's verified in code:** `src/lib/regionCheck.js` runs `verifySupabaseRegion()`
at startup (called from `src/lib/supabase.js`). It logs `Supabase region: <label> — US ✓`
in dev and warns loudly if the configured region is non-US or undetermined.

**Important nuance:** A Supabase **cloud** project URL is `https://<project-ref>.supabase.co`.
The project ref is opaque — **the URL does not encode the region.** A substring check on
the URL therefore cannot prove the region. The authoritative source is the dashboard, and
the value is recorded in the `VITE_SUPABASE_REGION` environment variable (set in `.env.local`
locally and **must also be set in Netlify env for production**).

**Action required (dashboard):** Confirm Supabase Dashboard → Project Settings → General →
Region. Set `VITE_SUPABASE_REGION` to match (e.g. `us-east-1`). Current configured value:
`us-east-1` (US East — **pending dashboard confirmation**). US regions recognized:
`us-east-1`, `us-east-2`, `us-west-1`, `us-west-2`.

## 2. Force HTTPS Everywhere — Transmission Security (§164.312(e)(1))
Configured in `netlify.toml`:
- **301 redirect** `http://*` → `https://:splat` (`force = true`).
- **`Content-Security-Policy: upgrade-insecure-requests`** — auto-upgrades any http
  subresource to https.
- **`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`** — pins HTTPS.
- Plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`.

## 3. Supabase Client Initialization Audit
`src/lib/supabase.js` initializes the client with:
`autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: true`,
`storageKey: 'caselift-auth'`.

**Service-role key — CRITICAL CHECK:** searched the entire `src/` tree for
`service_role` / `SERVICE_ROLE` / `serviceRole` → **0 matches.** The frontend uses only the
anon (publishable) key. The service-role key (which bypasses RLS) exists solely as an
edge-function secret (`SUPABASE_SERVICE_ROLE_KEY`) and is never bundled into client code.
✅ No critical exposure found.

> Note: setting `storageKey` changes the persisted-session localStorage key from the SDK
> default, so existing users are signed out **once** on the deploy that ships this change.

## 4. Transport Security — Edge Function External Calls (§164.312(e)(1))
Audited `supabase/functions/`. **Every external API call uses HTTPS.** No `http://`,
`ws://`, or `ftp://` URLs found (excluding XML-namespace/localhost references). Endpoints in use:

| Service   | Endpoint                  | TLS |
|-----------|---------------------------|-----|
| Anthropic | `https://api.anthropic.com` | ✅ |
| OpenAI    | `https://api.openai.com`    | ✅ |
| Twilio    | `https://api.twilio.com` (+ `messaging.`, `trusthub.`, `www.`) | ✅ |
| Mailgun   | `https://api.mailgun.net`   | ✅ |
| Helcim    | `https://api.helcim.com`    | ✅ |
| Sikka     | `https://api.sikkasoft.com` | ✅ (integrated) |
| Chargebee | `https://dtgsaas.chargebee.com` | ✅ |
| Supabase  | `https://<ref>.supabase.co` | ✅ |

## 5. Database Encryption at Rest (§164.312(a)(2)(iv))
**Statement of record:** *"Supabase Pro plan includes AES-256 encryption at rest for all
data, including the Postgres database and storage buckets."*

**Action required (dashboard):** Confirm the project is on the **Supabase Pro plan** (not the
free tier) — Dashboard → Project Settings → Billing. Pro is also required for the MFA feature
shipped separately. Record the confirmation date here once verified.

---

## Summary of Verifications
| Item | Result |
|------|--------|
| US region check at startup | ✅ Implemented (`regionCheck.js`); dashboard value pending |
| Force HTTPS (redirect + HSTS + CSP upgrade) | ✅ `netlify.toml` |
| Supabase client init (4 auth options) | ✅ `supabase.js` |
| No `service_role` in `src/` | ✅ 0 matches |
| Edge-function calls over HTTPS | ✅ all HTTPS, 0 insecure |
| Encryption at rest documented | ✅ this doc; Pro-plan confirmation pending |

## Outstanding Dashboard Confirmations
1. Supabase region (Project Settings → General → Region) → set `VITE_SUPABASE_REGION` (+ Netlify env).
2. Supabase **Pro plan** active (Project Settings → Billing).
3. Netlify "Force HTTPS" toggle enabled (belt-and-suspenders alongside the redirect).
