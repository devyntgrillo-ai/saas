# Power Dialer - in-app Twilio Voice calling + recording

The Power Dialer places and records calls in the browser via the Twilio Voice
JS SDK. Architecture:

- **`twilio-voice-token`** (verify_jwt on) - mints a Twilio AccessToken for the
  signed-in user's practice. The browser `Device` uses it to place calls.
- **`twilio-voice-twiml`** (`--no-verify-jwt`) - the TwiML App Voice webhook.
  Returns `<Dial callerId record="record-from-answer-dual">` and inserts a
  `call_logs` row keyed by the Twilio CallSid.
- **`twilio-recording-callback`** (`--no-verify-jwt`) - attaches the finished
  recording (URL/sid/duration) to that `call_logs` row.
- Frontend: `src/pages/PowerDialer.jsx` (live call panel: connecting/ringing/
  recording timer, mute, hang up) + `src/lib/voice.js`. Falls back to a `tel:`
  link when Twilio isn't configured.
- DB: `call_logs` (migration `20260601000000_call_logs.sql`) + `practices.twilio_phone_number`.

## One-time Twilio setup

1. **API Key** - Twilio Console → Account → API keys & tokens → Create standard
   key. Note the **SID** and **Secret**.
2. **TwiML App** - Console → Voice → TwiML → TwiML Apps → Create.
   - Voice **Request URL** (HTTP POST):
     `https://eymgqjeudrmeofytnwgs.supabase.co/functions/v1/twilio-voice-twiml`
   - Save; note the **App SID**.
3. **Voice-capable number** - buy/assign one. Use it as the platform fallback
   caller ID, or set it per-practice in `practices.twilio_phone_number`
   (the TwiML uses the practice's number when present, else `TWILIO_CALLER_ID`).
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
