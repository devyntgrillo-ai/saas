# Power Dialer + two-way calling (Twilio Voice)

In-app Twilio Voice for outbound calls, plus **inbound call-back** when a patient
dials the practice number.

## Architecture

### Outbound (practice → patient)
- **`twilio-voice-token`** (verify_jwt on) - mints AccessToken; browser `Device` places calls.
- **`twilio-voice-twiml`** (`--no-verify-jwt`) - TwiML App webhook; dials patient with recording.
- Frontend: `VoiceContext` + `voice.js` → Conversations, Power Dialer, global `VoiceCallBar`.

### Inbound (patient → practice number)
- **`twilio-voice-inbound`** (`--no-verify-jwt`) - Voice webhook on each practice number:
  finds/creates conversation, logs inbound call in thread, rings browser + optional forward phone.
- Settings: **Settings → Messaging → Inbound calls** (`inbound_call_ring_browser`, `inbound_call_forward_phone`).
- Migration: `20260605120000_inbound_call_settings.sql`.

### Shared
- **`twilio-recording-callback`** - attaches recording; triggers **`transcribe-call-log`**.
- **`twilio-recording-audio`** (verify_jwt on) - authenticated playback proxy.
- DB: `call_logs` + `practices.twilio_phone_number`.

## One-time Twilio setup

1. **API Key** - Twilio Console → Account → API keys & tokens → Create standard
   key. Note the **SID** and **Secret**.
2. **TwiML App** - Console → Voice → TwiML → TwiML Apps → Create.
   - Voice **Request URL** (HTTP POST):
     `https://eymgqjeudrmeofytnwgs.supabase.co/functions/v1/twilio-voice-twiml`
   - Save; note the **App SID**.
3. **Voice-capable number** - buy/assign per practice (Phone setup wizard). Provision sets:
   - SMS webhook → `twilio-inbound?practice_id=…`
   - Voice webhook → `twilio-voice-inbound?practice_id=…`
4. **Secrets** (Supabase → Edge Functions → Secrets):
   ```bash
   supabase secrets set TWILIO_ACCOUNT_SID=ACxxxx
   supabase secrets set TWILIO_API_KEY_SID=SKxxxx
   supabase secrets set TWILIO_API_KEY_SECRET=xxxx
   supabase secrets set TWILIO_TWIML_APP_SID=APxxxx
   supabase secrets set TWILIO_CALLER_ID=+1XXXXXXXXXX   # fallback caller ID
   ```

Until these are set, `twilio-voice-token` returns 503 and the dialer shows
"in-app calling isn't set up yet" and uses the device dialer instead.

**Existing numbers:** run `sync-inbound-webhook` via `twilio-provision` (or re-save
inbound call settings after deploy) so Voice URL is set on numbers purchased before
this feature.

Deploy functions:

```bash
supabase functions deploy twilio-voice-inbound --no-verify-jwt --project-ref eymgqjeudrmeofytnwgs
supabase functions deploy transcribe-call-log --no-verify-jwt --project-ref eymgqjeudrmeofytnwgs
supabase functions deploy twilio-recording-callback --no-verify-jwt --project-ref eymgqjeudrmeofytnwgs
```

Apply migrations `20260604180000_call_log_transcripts.sql` and
`20260605120000_inbound_call_settings.sql`.

## Playback (built)
- **`twilio-recording-audio`** (verify_jwt on) proxies the recording: the browser
  fetches it with the user's JWT, the function verifies the practice owns the
  `call_log`, then streams the media from Twilio with Basic auth (forwards Range
  for seeking). Reuses `TWILIO_API_KEY_SID/SECRET` - no extra secret.
- The Power Dialer landing shows a **Recent calls** list with inline **Play**
  (via `loadRecordingUrl()` → object URL → `<audio>`), disposition, and duration.

## Recording disclosure (built, configurable)
- Enabled by default: a `<Say>` plays before the dial. Disable with
  `TWILIO_RECORDING_DISCLOSURE=false`; customize wording with
  `TWILIO_RECORDING_DISCLOSURE_TEXT`.
- ⚠️ This announces to the **caller (TC)**, not the patient. True two-party
  (callee) consent needs a whisper/conference flow (e.g. `<Conference>` with an
  announcement, or a `<Number url="...">` whisper) - wire that for two-party
  states before recording patients.

## Follow-ups
- A "recent calls / play recording" view in Conversations or ConsultDetail
  (the data is in `call_logs`, practice-scoped via RLS).
