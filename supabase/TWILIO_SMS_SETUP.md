# Two-way SMS (Twilio)

Hope sends and receives patient SMS through Supabase Edge Functions. Outbound
messages go through **`twilio-send`**; inbound replies hit **`twilio-inbound`**.

## Architecture

| Function | JWT | Role |
|----------|-----|------|
| **`twilio-send`** | on (service role OK) | Outbound SMS from Conversations, sequence cron, reactivation drip |
| **`twilio-inbound`** | off | Twilio Messaging webhook — inserts inbound `conversation_messages` |
| **`twilio-status`** | off | Delivery status callback — updates `meta.delivery_status` |
| **`twilio-provision`** | on | Search/purchase US numbers by area code per practice |
| **`twilio-a2p`** | on | A2P 10DLC brand + campaign registration, status polling |

## Self-serve provisioning (Settings → Phone & Messaging)

1. **Search** — `twilio-provision` `search-numbers` by US area code  
2. **Purchase** — saves `twilio_phone_number`, inbound webhook on the number  
3. **A2P** — `twilio-a2p` `register` creates Messaging Service, submits brand/campaign  
4. **Poll** — UI polls `poll-status` until `a2p_*_status = approved` → `sms_enabled = true`  
5. **Send** — `twilio-send` uses the practice **Messaging Service** when A2P is approved; blocks outbound until then (unless `TWILIO_A2P_SKIP_ENFORCEMENT=true` for local dev only)

### Extra secrets (production A2P — ISV API)

Trust Hub + brand registration run automatically in `twilio-a2p` when a practice submits the wizard.

**Required on production** (Hope ISV account):

```bash
# Approved Primary Business Profile (Trust Hub → BU…)
TWILIO_PRIMARY_CUSTOMER_PROFILE_SID=BUxxxxxxxx

# ISV inbox for Trust Hub / profile status emails (not the dental practice)
TWILIO_TRUSTHUB_NOTIFICATION_EMAIL=ops@yourplatform.com
```

**Optional** — skip Trust Hub API if you already created bundles manually:

```bash
TWILIO_CUSTOMER_PROFILE_BUNDLE_SID=BUxxxxxxxx   # Secondary Customer Profile
TWILIO_A2P_PROFILE_BUNDLE_SID=BUxxxxxxxx         # A2P TrustProduct (step 2.1)
```

Legacy `TWILIO_A2P_BUNDLE_SID` is **not** used alone anymore; brand create requires **both** customer + A2P profile bundle SIDs per [Twilio ISV API guide](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api).

**Local only:**

```bash
TWILIO_A2P_DEV_AUTO_APPROVE=true   # auto-approve after wizard submit
TWILIO_A2P_SKIP_ENFORCEMENT=true   # allow send without A2P (dev only)
```

## Multi-tenant model (one Twilio account)

All practices share **one** `TWILIO_ACCOUNT_SID`. Each practice gets:

- Its own **phone number** (`twilio_phone_number`, `twilio_phone_e164`)
- Its own **Messaging Service** + **A2P campaign** (`twilio_messaging_service_sid`)
- Outbound via **`twilio-send`** → Messaging Service when A2P is approved, else blocked (no shared `TWILIO_CALLER_ID` in production)
- Inbound webhook per practice: `.../twilio-inbound?practice_id=<uuid>` (indexed lookup on `twilio_phone_e164`)

Re-sync an existing number’s webhook after deploy:

```json
POST twilio-provision { "action": "sync-inbound-webhook", "practice_id": "..." }
```

## Practice phone number

Each practice sends from `practices.twilio_phone_number`. Use **Settings → Phone & Messaging → Set up texting** (self-serve wizard), or Agency → Phone Numbers for multi-practice admins.

Inbound inserts fire existing DB triggers:

- **`trg_auto_pause_on_reply`** — pauses the consult sequence when the practice has stop-on-reply enabled
- **`trg_log_patient_replied`** — attribution event
- STOP / UNSUBSCRIBE / CANCEL / END / QUIT → sets `conversations.opted_out = true`

## Secrets

Add to `supabase/.env.local` (local) or Supabase → Edge Functions → Secrets (prod):

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxx          # required
TWILIO_AUTH_TOKEN=xxxxxxxx             # required for SMS (unless using API key below)
TWILIO_API_KEY_SID=SKxxxxxxxx          # optional — only needed for in-browser voice dialer
TWILIO_API_KEY_SECRET=xxxxxxxx
TWILIO_CALLER_ID=+1XXXXXXXXXX            # dev only: used only with TWILIO_A2P_SKIP_ENFORCEMENT when practice has no number
TWILIO_WEBHOOK_BASE_URL=https://...      # public URL Twilio can reach (see below)
```

**SMS only needs Account SID + Auth Token** (or Account SID + API key). The Auth Token
is the same credential from Twilio Console → Account → Auth Token.

## Practice phone number (manual fallback)

Each practice sends from `practices.twilio_phone_number`. Prefer the self-serve wizard; manual SQL only for debugging:

```sql
update public.practices
   set twilio_phone_number = '+15551234567'
 where id = '<your-practice-id>';
```

Use the same number in the Twilio console for the Messaging webhook.

## Local dev with VS Code port forwarding

1. Start Supabase and edge functions:
   ```bash
   npx supabase start
   npm run supabase:functions
   ```
2. Forward port **54321** (Supabase API + functions) in VS Code → Ports.
3. Copy the **public forwarded URL** (e.g. `https://xxxx-54321.app.github.dev`).
4. Set in `supabase/.env.local`:
   ```bash
   TWILIO_WEBHOOK_BASE_URL=https://xxxx-54321.app.github.dev
   ```
   Restart `npm run supabase:functions` after changing env.
5. In Twilio Console → Phone Numbers → your number → **Messaging**:
   - **A message comes in**: Webhook, HTTP POST  
     `{TWILIO_WEBHOOK_BASE_URL}/functions/v1/twilio-inbound`
6. Text the Twilio number from your phone — a conversation should appear in **Conversations**.

Outbound from the app uses the same credentials; no extra webhook needed for send.

## Production deploy

```bash
supabase functions deploy twilio-send --project-ref <ref>
supabase functions deploy twilio-provision --project-ref <ref>
supabase functions deploy twilio-a2p --project-ref <ref>
supabase functions deploy twilio-inbound --no-verify-jwt --project-ref <ref>
supabase functions deploy twilio-status --no-verify-jwt --project-ref <ref>
```

Set `TWILIO_WEBHOOK_BASE_URL` to your project URL, e.g.  
`https://<ref>.supabase.co`

Twilio Messaging webhook:

`https://<ref>.supabase.co/functions/v1/twilio-inbound`

## Testing checklist

- [ ] `TWILIO_ACCOUNT_SID` set; functions restarted
- [ ] Practice row has `twilio_phone_number` matching your Twilio number
- [ ] Inbound webhook URL reachable (port forward or prod URL)
- [ ] Send SMS from Conversations → patient receives it
- [ ] Settings → Phone & Messaging → **Send test SMS** (when A2P active)
- [ ] Reply from phone → thread shows inbound message, unread badge increments
- [ ] Reply `STOP` → conversation marked opted out in Settings → Phone & Messaging counts

## Related

- Voice calling: [`TWILIO_VOICE_SETUP.md`](./TWILIO_VOICE_SETUP.md)
- Frontend: `src/pages/Conversations.jsx` invokes `twilio-send` after inserting an outbound row
