# Mailgun email (production)

All outbound email uses **Mailgun** via edge functions. Set secrets on the hosted project:

**Dashboard → Project Settings → Edge Functions → Secrets**

| Secret | Required | Example |
|--------|----------|---------|
| `MAILGUN_DOMAIN` | yes | `mg.heyhope.ai` |
| `MAILGUN_API_KEY` | yes | `key-...` |
| `MAILGUN_FROM` | optional | `Hope AI <noreply@mg.heyhope.ai>` |

Deploy after code changes:

```bash
npx supabase login
npm run deploy:managed:functions
```

## Two-way email in Conversations

Outbound uses `mailgun-send`. **Patient replies** require `mailgun-inbound` + a Mailgun inbound route. See **`MAILGUN_INBOUND_SETUP.md`**.

## Send paths (all use Mailgun)

| Function | Trigger |
|----------|---------|
| `mailgun-send` | Conversations (email), `send-due-messages`, `process-reactivation-drip` |
| `mailgun-inbound` | Mailgun inbound route (patient email replies) |
| `invite-practice-user` | Agency → Add practice |
| `invite-team-member` | Onboarding TC invite, InviteModal, practice team invites |
| `send-client-invite` | Super-admin / reseller new practice (API) |
| `send-weekly-digest` | Cron + Settings → Notifications test |
| `weekly-intelligence-digest` | Cron (Monday intelligence) |
| `notify-payment-failure` | Lemon Squeezy webhook |

## Troubleshooting

**`mailgun_403` / “Please activate your Mailgun account”**  
The project secrets point at a Mailgun **sandbox** domain. In [Mailgun](https://app.mailgun.com/):

1. Complete account activation (email from Mailgun).
2. For sandbox: add each test address under **Sending → Domain settings → Authorized recipients** (e.g. `adeoyeadebayo18@gmail.com`).
3. For production: verify your own domain (e.g. `mg.heyhope.ai`), update `MAILGUN_DOMAIN` + `MAILGUN_FROM` secrets, redeploy functions.

## Test from the app

1. Sign in to production app.
2. **Settings → Phone & Messaging → Email Settings → Send test email**
3. Enter `adeoyeadebayo18@gmail.com` and click **Send test**.

## Test from CLI

```bash
export SUPABASE_SERVICE_ROLE_KEY='<service_role from Dashboard>'
export SUPABASE_ACCESS_TOKEN='<user JWT from browser session>'
node scripts/send-test-email.mjs --practice <your-practice-uuid> --to adeoyeadebayo18@gmail.com
```

The user JWT is required because `mailgun-send` verifies practice access (same as `twilio-send`).
