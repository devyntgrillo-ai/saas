# Follow-up sequence scheduling

## How messages get scheduled

1. **`analyze-consult`** — After AI analysis, creates up to **12** messages from practice touchpoints + smart-timing preset (`hot` / `warm` / `long_term`). Uses channels from config/preset (not a fixed SMS/email alternation). Computes `scheduled_for` in the **practice timezone** (hold, quiet hours, weekends).
2. **`process-sequences`** (cron) — Activates pending consults after the hold; cancels on terminal outcomes; respects **auto-start** vs **TC approval** (`followup_approved_at`).
3. **`send-due-messages`** (cron) — Sends due messages via **`twilio-send`** / **`mailgun-send`**. Skips until `sequence_activated_at`, `followup_approved_at` (when manual start), or if paused.

Shared logic: `supabase/functions/_shared/sequence.ts` (mirrored in `src/lib/sequence.js`).

## Cron (production)

Migration `20260602130100_cron_sequence_jobs.sql` schedules `process-sequences` and `send-due-messages` every 5 minutes.

**Preferred:** run `supabase/apply_cron.sql` in the SQL editor with your current `service_role` key inlined (see file header). Cron jobs pass that JWT in `Authorization`; edge functions use it for DB access and internal `mailgun-send` / `twilio-send` calls so sends keep working even if a stale `SUPABASE_SERVICE_ROLE_KEY` function secret exists.

**Do not** set a custom `SUPABASE_SERVICE_ROLE_KEY` in Edge Function secrets unless required — it can drift from the live API key after rotation. If one exists, delete it in Dashboard → Edge Functions → Secrets.

## Verify locally

```bash
npx supabase migration up          # apply migrations
docker restart supabase_edge_runtime_tii-platform  # reload edge functions after code changes
npm run test:scheduling            # automated scheduling checks
```

## Local development

`pg_cron` may not run locally. Tick the sender manually:

```bash
npm run supabase:cron-tick
# or: bash scripts/cron-tick.sh
```

Run every few minutes while testing scheduled sends, or use a watch:

```bash
watch -n 300 npm run supabase:cron-tick
```

## Manual TC approval

When **Integrations → Auto-start follow-up** is off:

- Analysis creates **`draft`** messages without `scheduled_for`.
- TC opens the consult and clicks **Approve & schedule follow-up** (or edits timing on Sequences).
- `followup_approved_at` is set; messages become **`scheduled`** with proper `scheduled_for`.

## Email

Set `MAILGUN_DOMAIN` and `MAILGUN_API_KEY` on edge functions. Sequence email uses **`mailgun-send`**.
