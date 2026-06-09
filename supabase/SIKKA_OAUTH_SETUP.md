# Sikka OAuth 2.0 - setup & deploy

The Sikka integration now uses **OAuth 2.0 per-practice tokens** instead of a
platform-wide `SIKKA_API_KEY`. Each practice authorizes the app once; we store
its `request_key` + `refresh_token` and auto-refresh before every sync.

## 1. Database migration

Run **`supabase/migrations/20260530030000_sikka_oauth.sql`** (or the consolidated
`apply_all.sql`) in the SQL editor. It adds to `practices`:
`sikka_request_key`, `sikka_refresh_token`, `sikka_token_expires_at`.
(`sikka_practice_id` = the Sikka `office_id`, and `sikka_connected` already exist.)

## 2. Secrets (Supabase → Project Settings → Edge Functions → Secrets)

```bash
supabase secrets set SIKKA_APP_ID=<application_id from Sikka developer portal>
supabase secrets set SIKKA_APP_SECRET=<application_secret_key>
supabase secrets set APP_URL=https://<your-frontend-host>      # where users return after auth
supabase secrets unset SIKKA_API_KEY                            # old model - remove
```

Optional overrides (defaults shown) - see §6:
`SIKKA_BASE_URL=https://api.sikkasoft.com/v4`,
`SIKKA_TOKEN_URL` (defaults to `{base}/token`; override if the OAuth token
endpoint lives elsewhere), `SIKKA_TOKEN_PATH=/token`,
`SIKKA_APPOINTMENTS_PATH=/appointments`,
`SIKKA_AUTHORIZED_PRACTICES_PATH=/authorized_practices`,
`SIKKA_AUTHORIZE_URL=https://api.sikkasoft.com/portal/authapp.aspx`,
`SIKKA_REDIRECT_URI` (defaults to the callback function URL),
`SIKKA_SYNC_DAYS=30`.

## 3. Register the redirect URI in the Sikka developer portal

Value the functions use (must match exactly):

```
https://eymgqjeudrmeofytnwgs.supabase.co/functions/v1/sikka-oauth-callback
```

(If you register a different URI, set `SIKKA_REDIRECT_URI` to the same value.)

**Where in the portal:** log in at `https://api.sikkasoft.com/v4/portal`
(register: `/v4/portal/authentication/register`). The `application_id` /
`application_secret_key` live under the app management area - look for
**My Apps → Application Details / App Settings** for a redirect/callback URI field.

⚠️ **Caveat:** Sikka's v4 model is primarily `app_id`/`app_key` → `request_key`
(tied to `office_id`) granted when the practice authorizes the app, plus
webhooks - it may not use a classic authorization-code redirect at all. If there
is **no redirect-URI field** in the portal, that's expected: the working
integration is the webhook + `request_key` path (already live), and the
authorization-code callback simply isn't needed. Confirm with Sikka support if
unsure.

## 4. Consult sync calibration (v2)

After a practice connects Sikka, **no appointments sync until a practice admin approves**
the consult filter rules.

| Setting | Default | Range |
|---------|---------|-------|
| History (backfill) | **1 year** | 1–5 years (`pms_history_years`) |
| Forward look | **1 year** | 1–5 years (`pms_forward_years`) |

**Flow**

1. **Discovery** (`discover-pms-consults`) — scans appointments across the configured
   year window (chunked at 1 year per Sikka API call), clusters appointment types +
   procedure codes, then **always runs AI** (Anthropic) to classify each cluster as
   `likely_consult` / `likely_routine` / `unknown`.
2. **Approval** (`approve-pms-sync`) — practice admin reviews clusters in
   **Settings → PMS**, adjusts checkboxes + year sliders, clicks **Approve & start sync**.
3. **Ongoing sync** (`sync-appointments`, webhooks) — only matched consult rows land in
   `pms_appointments`; excluded types are hidden entirely. Patients are JIT-synced from
   matched appointments only.

Migration: `supabase/migrations/20260609040000_pms_sync_calibration.sql`

Deploy:

```bash
supabase functions deploy discover-pms-consults
supabase functions deploy approve-pms-sync
```

## 5. Deploy the functions

```bash
supabase functions deploy sync-appointments
supabase functions deploy search-sikka-practice
# ⚠️ The callback's GET is hit by Sikka's browser redirect with NO JWT, so it
# MUST be deployed with --no-verify-jwt (its POST initiator does its own auth):
supabase functions deploy sikka-oauth-callback --no-verify-jwt
```

## 6. Connect flow (what the user does)

Settings → Integrations → PMS → **Connect to Sikka** → approves in Sikka's
portal → redirected back to `/settings/integrations?sikka=connected`. Tokens are
saved; the 15-min `sync-appointments` cron (see `apply_cron.sql`) then pulls
appointments. "Sync now" / admin "Test Sync" both work immediately.

## 7. API version - confirmed v4

Confirmed against Sikka's knowledge base + API portal (api.sikkasoft.com/v4):
- **Base: `https://api.sikkasoft.com/v4`** (default).
- **`GET /v4/appointments`** with the **`request_key` in a `Request-Key` header**
  (we send it as a header AND query param), `office_id` + `startdate`/`enddate`
  range. Response is `{ summary, data: { items, startdate, enddate } }` -
  unwrapped automatically.
- `authorized_practices` for the office list.

Still verify against your account's docs (env-overridable, no redeploy needed):
- the OAuth **token endpoint URL** (`SIKKA_TOKEN_URL`) and whether it expects
  `client_id/secret` or `app_id/app_key` (we send both),
- the exact appointment date-range param names if your account differs.

## 8. Webhook events (`sikka-connect-webhook`)

The single webhook receiver routes every Sikka event by type (tolerates the
"… details" suffixes and singular/plural). Office linkage: payload `office_id`
(e.g. `D24710`) → `practices.sikka_practice_id`.

| Event | Action |
|---|---|
| `Data_Refresh` | invoke `sync-appointments` for that office |
| `appointment(s)` | upsert matched consult `pms_appointments` only (after admin approval) |
| `patient(s)` | no-op (patients JIT from matched appointments) |
| `treatment_plan(s)` | match patient → open consult → `closed_won` + cancel sequence |
| `transaction(s)` | upsert `pms_transactions` (reporting) |
| `provider(s)` | upsert `pms_providers` |
| `practice(s)` | update the practice's PMS info |

Run migration **`20260530040000_pms_entities.sql`** (or `apply_all.sql`) to
create `pms_patients` / `pms_providers` / `pms_transactions` - until then those
three event types will error (appointment / treatment_plan / practice /
Data_Refresh work without it). Deployed with `--no-verify-jwt`. Optional
`SIKKA_WEBHOOK_SECRET` → require it in the `X-Sikka-Secret` header.
