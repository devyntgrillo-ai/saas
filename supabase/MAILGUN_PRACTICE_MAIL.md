# Per-practice patient email (Option 2)

Patient-facing mail uses **per-practice subdomains** on your managed zone:

- Host: `{mail_subdomain}.mail.heyhope.ai` (e.g. `smith-dental.mail.heyhope.ai`)
- From: `office@{subdomain}.mail.heyhope.ai` (display name from Settings → Email)
- Reply-To (Conversations / sequences): `reply+{conversation_id}@{subdomain}.mail.heyhope.ai`

**Platform mail** (invites, billing, staff digests) still uses `MAILGUN_DOMAIN` (e.g. `mg.heyhope.ai`).

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
| MX | `mail.heyhope.ai` | `mxa.mailgun.org` (priority 10), `mxb.mailgun.org` (priority 10) |
| MX | `*.mail.heyhope.ai` | same as above (wildcard receive) |
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
| `MAILGUN_WEBHOOK_SIGNING_KEY` | recommended | from Mailgun webhooks | `mailgun-inbound` |

`MAILGUN_PATIENT_MAIL_DOMAIN` is usually the same as `MAILGUN_PATIENT_MAIL_ROOT` (the wildcard domain registered in Mailgun).

### 4. Inbound route (patient replies)

Mailgun → **Routes** (high priority):

| Field | Value |
|-------|--------|
| Expression | `match_recipient("reply+.*@.*\.mail\.heyhope.ai")` |
| Action | `forward("https://<project-ref>.supabase.co/functions/v1/mailgun-inbound")` |

Optional legacy route if you previously used platform domain for patient mail:

```
match_recipient("reply+.*@mg.heyhope.ai")
```

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
