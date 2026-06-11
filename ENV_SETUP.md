# Environment variables

**Default:** the app targets the **managed** Supabase project `eymgqjeudrmeofytnwgs`.

## Frontend (`.env.local` at repo root)

```bash
VITE_SUPABASE_URL=https://eymgqjeudrmeofytnwgs.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Dashboard → Settings → API>
```

Regenerate after rotating keys:

```bash
ANON_KEY='eyJ...' ./scripts/use-managed-env.sh
```

Run the app:

```bash
npm install
npm run dev
```

## Helcim (Payment Processing)

Billing runs on **Helcim** (card processing is Helcim.js inline; the raw card
never touches our servers).

**Server-side secrets** (Supabase → Edge Functions → Secrets, or via CLI):

- `HELCIM_API_KEY` — Helcim API key. Used by every server-side Helcim call
  (`helcim-checkout`, `admin-onboard-practice`, `process-billing-renewals`).
- `HELCIM_WEBHOOK_VERIFIER_TOKEN` — Helcim dashboard → Webhooks → Verifier
  Token. Required: `helcim-webhook` rejects any delivery whose signature
  doesn't verify against this.

```bash
npx supabase secrets set HELCIM_API_KEY="your-key" --project-ref eymgqjeudrmeofytnwgs
npx supabase secrets set HELCIM_WEBHOOK_VERIFIER_TOKEN="your-verifier-token" --project-ref eymgqjeudrmeofytnwgs
```

**Frontend tokens** (`.env.local`) — Helcim.js config tokens (frontend-safe):

- `VITE_HELCIM_JS_TOKEN` — purchase config (charges the card).
- `VITE_HELCIM_JS_VERIFY_TOKEN` — verify config (tokenizes a card at $0 for
  card-on-file updates and trials).

Production: the Helcim.js config must be **live** (test:0) with amount hashing
(`enforceHashing`) enabled in the Helcim dashboard.

## Deploy schema + edge functions to managed

```bash
npx supabase login
npm run deploy:managed          # migrations + all functions
npm run deploy:managed:db       # migrations only
npm run deploy:managed:functions
```

Edge function **secrets** stay on the hosted project (Dashboard → Edge Functions → Secrets). The CLI cannot download secret values.

## Optional: local Supabase (legacy)

Only if you need an offline DB:

```bash
npx supabase start
npm run setup:local-env
npm run dev:local
```

Local keys must **not** be mixed into `.env.local` when using managed Supabase for the frontend.

## Cron on hosted

After deploy, ensure cron DB settings are set once (see `supabase/apply_cron.sql` or `supabase/SEQUENCE_SCHEDULING.md`).
