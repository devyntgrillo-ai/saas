# Hope AI (SaaS)

React + Vite frontend with Supabase (Postgres, Auth, Edge Functions).

**Managed project:** [eymgqjeudrmeofytnwgs](https://supabase.com/dashboard/project/eymgqjeudrmeofytnwgs)

## Quick start (managed Supabase)

```bash
npm install
# .env.local should contain VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (see ENV_SETUP.md)
npm run dev
```

Open http://localhost:5173 — the app talks to hosted Supabase, not a local stack.

## Deploy database + functions

```bash
npx supabase login
npm run deploy:managed
```

See `ENV_SETUP.md`, `supabase/SEQUENCE_SCHEDULING.md`, `supabase/TWILIO_SMS_SETUP.md`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server → managed Supabase |
| `npm run deploy:managed` | Push migrations + deploy all edge functions |
| `npm run build` | Production build |
