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
