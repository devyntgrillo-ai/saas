# Per-practice patient email (Option 2)

Patient-facing mail uses **per-practice subdomains** on your managed zone:

- Host: `{mail_subdomain}.{MAILGUN_PATIENT_MAIL_ROOT}` (e.g. `gold-dental.mysmileinbox.com`)
- From: `office@{subdomain}.{root}` (display name from Settings → Email)
- Reply-To (Conversations / sequences): `reply+{conversation_id}@mysmileinbox.com` (root receive host with MX). **From** stays `office@{subdomain}.mysmileinbox.com`. Optional aligned Reply-To on the practice host requires wildcard MX `*.mysmileinbox.com` in DNS + `MAILGUN_REPLY_TO_ON_PRACTICE_HOST=true`.

**Platform mail** (invites, billing, staff digests) still uses `MAILGUN_DOMAIN` (e.g. `caselift.io`).

## Architecture

```mermaid
flowchart TB
  subgraph platform [Platform MAILGUN_DOMAIN]
    INV[invite-* / digests / billing]
  end
  subgraph patient [Wildcard mail.heyhope.ai in Mailgun]
    P1[office@smith.mail.heyhope.ai]
    P2[office@pr-abc.mail.heyhope.ai]
  end
  SEND[mailgun-send] --> patient
  INV --> platform
  Patient -->|Reply| IN[mailgun-inbound] --> DB[(conversation_messages)]
```

## One-time Mailgun + DNS setup

### 1. DNS (your DNS provider for heyhope.ai)

Add records for the **patient mail zone** (adjust if your root differs):

| Type | Host | Value |
|------|------|--------|
| MX | `mysmileinbox.com` | `mxa.mailgun.org` (10), `mxb.mailgun.org` (10) |
| MX | `*` (wildcard) | same as above — **required** for Reply-To on `{sub}.mysmileinbox.com` |
| TXT | `mail.heyhope.ai` | SPF per Mailgun dashboard after adding domain |
| TXT | `smtp._domainkey.mail.heyhope.ai` | DKIM from Mailgun |
| CNAME | `email.mail.heyhope.ai` | `mailgun.org` (tracking, if Mailgun shows it) |

Use exact values from **Mailgun → Sending → Domains → mail.heyhope.ai → DNS records**.

### 2. Mailgun domain (wildcard)

1. Add domain **`mail.heyhope.ai`** in Mailgun.
2. Enable **Wildcard** on that domain (sends/receives for any `*.mail.heyhope.ai`).
3. Verify DNS until status is **Active**.

No per-practice domain creation in Mailgun is required; the app assigns `practices.mail_subdomain` in Postgres on first patient send.

### 3. Supabase Edge Function secrets

| Secret | Required | Example | Used by |
|--------|----------|---------|---------|
| `MAILGUN_API_KEY` | yes | `key-...` | All Mailgun functions |
| `MAILGUN_DOMAIN` | yes | `mg.heyhope.ai` | Platform email only |
| `MAILGUN_FROM` | optional | `CaseLift <noreply@mg.heyhope.ai>` | Platform From default |
| `MAILGUN_PATIENT_MAIL_ROOT` | yes | `mail.heyhope.ai` | Host suffix for practices |
| `MAILGUN_PATIENT_MAIL_DOMAIN` | yes | `mail.heyhope.ai` | Mailgun API v3 domain for patient sends |
| `MAILGUN_INBOUND_DOMAIN` | optional | `mysmileinbox.com` | Legacy override for inbound receive host docs; Reply-To uses practice subdomain host |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | recommended | from Mailgun webhooks | `mailgun-inbound` |

`MAILGUN_PATIENT_MAIL_DOMAIN` is usually the same as `MAILGUN_PATIENT_MAIL_ROOT` (the wildcard domain registered in Mailgun).

**Send behavior:** By default, `mailgun-send` uses **per-practice** From (`office@{subdomain}.{root}`) with the practice display name. Reply-To is `reply+{conversation_id}@` the mail root (e.g. `mysmileinbox.com`) so replies work with root MX only. Set `MAILGUN_REPLY_TO_ON_PRACTICE_HOST=true` after adding wildcard MX `*.mysmileinbox.com` at your DNS provider to align Reply-To with From.

### 4. Inbound route (patient replies)

Mailgun → **Routes** (high priority):

| Field | Value |
|-------|--------|
| Expression | `match_recipient("reply+.*@.*\.mysmileinbox.com")` (subdomain Reply-To) |
| Action | `forward("https://<project-ref>.supabase.co/functions/v1/mailgun-inbound")` |

Keep a **legacy** route during transition (older messages used root Reply-To):

```
match_recipient("reply+.*@mysmileinbox.com")
```

Or run: `MAILGUN_API_KEY=... node scripts/setup-mailgun-inbound-route.mjs`

### 5. Frontend (optional display)

In `.env` / Vite:

```bash
VITE_PATIENT_MAIL_ROOT=mail.heyhope.ai
```

Settings → Phone & Messaging shows the practice address after the first test send (when `mail_subdomain` is assigned).

## Deploy

```bash
npx supabase db push   # mail_subdomain columns
npm run deploy:managed:functions
# or:
npx supabase functions deploy mailgun-send mailgun-inbound --project-ref <ref>
```

## Send paths

| Audience | Function | Mailgun API domain |
|----------|----------|-------------------|
| Patient | `mailgun-send` | `MAILGUN_PATIENT_MAIL_DOMAIN` |
| Patient inbound | `mailgun-inbound` | `*.mail.heyhope.ai` routes |
| Platform | `invite-*`, `send-weekly-digest`, `weekly-intelligence-digest`, `notify-payment-failure`, `send-client-invite` | `MAILGUN_DOMAIN` |

## Verify two-way email

1. Settings → Messaging → Send test email (assigns subdomain).
2. Conversations → email a patient with `patient_email` set.
3. Patient **Reply**; thread updates via realtime.
4. Sequence emails also set `reply+{conversation_id}@…` when a consult conversation exists.

## Troubleshooting

- **`mailgun_401` on patient send:** `MAILGUN_PATIENT_MAIL_DOMAIN` not added/verified in Mailgun.
- **Reply not in thread:** inbound route must match `reply+.*@*.mail.heyhope.ai`; check `MAILGUN_WEBHOOK_SIGNING_KEY`.
- **Wrong practice on fallback match:** fallback is scoped by subdomain on the recipient; use Reply on the CaseLift email.
