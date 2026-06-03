# Two-way SMS (Twilio)

CaseLift sends and receives patient SMS through Supabase Edge Functions. Outbound
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
5. **Send** — `twilio-send` blocks outbound until A2P approved (unless `TWILIO_A2P_SKIP_ENFORCEMENT=true`)

### Extra secrets (production A2P)

```bash
TWILIO_A2P_BUNDLE_SID=BUxxxxxxxx   # Trust Hub customer profile bundle (ISV setup)
# Local only:
TWILIO_A2P_DEV_AUTO_APPROVE=true   # auto-approve after wizard submit
TWILIO_A2P_SKIP_ENFORCEMENT=true   # allow send without A2P (dev only)
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
TWILIO_CALLER_ID=+1XXXXXXXXXX            # optional fallback From when practice has no number
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
- [ ] Reply from phone → thread shows inbound message, unread badge increments
- [ ] Reply `STOP` → conversation marked opted out in Settings → Phone & Messaging counts

## Related

- Voice calling: [`TWILIO_VOICE_SETUP.md`](./TWILIO_VOICE_SETUP.md)
- Frontend: `src/pages/Conversations.jsx` invokes `twilio-send` after inserting an outbound row
