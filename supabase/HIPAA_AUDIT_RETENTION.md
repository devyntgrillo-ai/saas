# HIPAA Audit-Log Retention & Archival

**Requirement:** HIPAA 45 CFR §164.316(b)(2)(i) — security documentation and audit
records must be retained **6 years** from the date of creation (or last in
effect). CaseLift's `public.audit_logs` table is the access trail for PHI
(consult/patient/transcript/conversation/recording views, message sends, auth
events, and access-denied attempts), so it falls under this requirement.

## ⚠️ Supabase does NOT guarantee 6-year retention natively
Managed Postgres backups (PITR) typically cover days–weeks, **not years**, and a
project deletion or plan change can drop data. Therefore audit data **must be
exported to independent long-term storage** and cannot rely on Supabase alone.

## What's automated
Migration `20260609110000_audit_log_archival.sql` provides:

- **`public.audit_logs_archive`** — an append-only mirror of `audit_logs` (same
  columns + RLS: own-practice and super-admin SELECT only). Historical records
  live here so the live table stays workable.
- **`archive_old_audit_logs(interval default '6 years')`** — copies rows older
  than the window into the archive and stamps `audit_logs.archived_at`. It
  **never deletes** from `audit_logs` (append-only integrity); it only copies +
  flags. Idempotent.
- **pg_cron job `archive-audit-logs`** — runs `03:00 UTC on the 1st of each
  month` and calls the function above.

Both `audit_logs` and `audit_logs_archive` remain **append-only**: there are no
UPDATE/DELETE RLS policies, and writes happen only via SECURITY DEFINER
functions / the service role.

## MANUAL annual export — REQUIRED (do not skip)
Because Supabase won't hold this for 6 years on its own, a workforce member
**must export the audit trail to long-term storage (S3 or Google Drive) once per
year** and log that it was done.

**Procedure (annually, e.g. each January):**
1. In the Supabase SQL editor, export both tables for the year(s) not yet
   exported, e.g.:
   ```sql
   -- newest live rows
   select * from public.audit_logs        order by created_at;
   -- everything already moved to the archive
   select * from public.audit_logs_archive order by created_at;
   ```
   Use the editor's **Download CSV**, or `COPY (...) TO STDOUT WITH CSV HEADER`
   via `psql`, to produce a file.
2. Upload the export to the long-term store:
   - **S3:** a bucket with Object Lock / versioning enabled, lifecycle ≥ 6 years
     (ideally WORM), restricted IAM access.
   - **Google Drive:** a restricted, access-logged compliance folder.
3. Verify the row counts match the query results.
4. Record the export in the compliance log: date, who performed it, date range
   covered, destination + object key/URL, and row count.
5. (Optional) Only after a verified export may rows older than 6 years be pruned
   from the archive — and only as a deliberate, reviewed manual step. The
   automated job never prunes.

**Retention target:** keep each export for at least **6 years** from the
creation date of the newest record it contains.

## Restore / audit access
- Super-admins can query `audit_logs` + `audit_logs_archive` directly (RLS
  grants super-admin SELECT).
- Practices can read their own rows in both tables.
- Long-term exports are the authoritative copy for any retention window beyond
  what the live database holds.

## Owner & cadence
- **Owner:** Platform admin (devyntgrillo@gmail.com).
- **Automated archival:** monthly (pg_cron).
- **Manual export to S3/Drive:** annually — **mandatory**, logged in
  `docs/compliance/`.
