# Environment variables

Do not commit env files. Copy these into local files that are gitignored (e.g. `.env.local`, `supabase/.env.local`).

## Frontend (`.env.local` at repo root)

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Supabase Edge Functions (`supabase/.env.local`)

Used by `npm run supabase:functions` locally:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
MAILGUN_DOMAIN=
MAILGUN_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_A2P_SKIP_ENFORCEMENT=true
```

Production: set secrets with `supabase secrets set KEY=value`.

See also `supabase/TWILIO_SMS_SETUP.md` and `supabase/SEQUENCE_SCHEDULING.md`.
