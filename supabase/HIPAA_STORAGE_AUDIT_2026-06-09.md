# HIPAA Storage Security Audit & Remediation Record

**System:** CaseLift
**Supabase project:** `eymgqjeudrmeofytnwgs`
**Date of audit:** 2026-06-09
**Scope:** All Supabase Storage buckets and the controls protecting consult audio (ePHI) — privacy, access control, signed-URL handling, retention/auto-deletion, and audit logging.
**Regulatory references:** 45 CFR §164.312(a)(1) access control, §164.312(b) audit controls, §164.312(c)(1) integrity, §164.502(b)/§164.514 minimum necessary & retention.

---

## 1. Methodology

Findings were verified against the **live** production project, not source code alone:

- Bucket privacy confirmed by unauthenticated requests to the public CDN endpoint (`/storage/v1/object/public/...`) — a `200` proves public exposure; `400 Bucket not found` proves private.
- Live schema confirmed via PostgREST column probes (a missing column returns SQL error `42703`).
- Bucket contents enumerated with `supabase storage ls`.
- Cron and policy state cross-checked against migrations, with the caveat that this project applies DB changes through the SQL editor (so the migration-tracking table is not authoritative).

---

## 2. Bucket inventory and disposition

| Bucket | Status (verified live) | Contents | PHI | Disposition |
|---|---|---|---|---|
| `consult-recordings` | Private | Consult audio | Yes (high) | Compliant — see §3 |
| `conversation-attachments` | Private | MMS/email patient files (empty at audit) | Yes (high) | Compliant |
| `chat-attachments` | Private | Support-chat uploads | Possible | Compliant |
| `testimonials` | Private | Testimonial video | Low/Med | Compliant |
| `avatars` | Public | Staff profile photos + seed images | No | Accepted (non-PHI) |
| `reseller-assets` | Public | White-label logos | No | Accepted (non-PHI) |

**Public-bucket PHI scan:** Contents of both public buckets were enumerated. No patient recordings, patient documents, or other ePHI were present — only staff profile images and branding assets. No remediation required.

---

## 3. `consult-recordings` control assessment

| Requirement | Result |
|---|---|
| Bucket is private | **Pass** — verified live |
| All access via signed URL | **Pass** — private bucket; URLs minted by the `get-recording-url` edge function |
| Signed URL expiry ≤ 1 hour | **Pass** — issued with a 3600-second (1 hour) TTL |
| Only the owning practice can obtain a URL | **Pass** — enforced at two layers: (1) the edge function re-checks the consult is visible under the caller's own token before signing; (2) `storage.objects` RLS scopes the bucket by practice via path prefix (`name like current_practice_id() || '/%'`), deployed in migration `20260603000004` |

**Note on the originally proposed RLS policy:** the policy drafted in the request referenced a `consults.audio_path` column and used `FOR ALL` matching `audio_storage_path = name`. Audit confirmed (a) the column is `audio_storage_path`, not `audio_path` (the proposed version would fail to create), and (b) a `FOR ALL` match would block uploads, since the storage path is written before the consult row records it. It was therefore **not applied**. The existing path-prefix policy already enforces the intended practice isolation and is more robust.

---

## 4. Findings requiring remediation

| # | Finding | Severity | Control |
|---|---|---|---|
| F-1 | Server-side audit logging was silently failing. The live `audit_logs` table was missing the `phi_accessed`, `details`, and `user_agent` columns and the `log_audit_event()` RPC, so every server-side access log — including recording-playback events — was being discarded. | **Critical** | §164.312(b) |
| F-2 | The 30-day audio auto-deletion job (`purge-consult-audio`) was not scheduled anywhere. The function existed and was correct, but no cron entry invoked it, so ePHI audio was being retained past the retention window. | **Critical** | §164.502(b) retention |
| F-3 | The auto-deletion job did not write an audit record when it deleted audio. | High | §164.312(b) |

---

## 5. Remediation actions taken (2026-06-09)

1. **F-1 — Restored the audit trail.** Applied the `audit_logs` HIPAA migration: added `phi_accessed`, `details`, `user_agent` columns and supporting indexes; created the `log_audit_event()` SECURITY DEFINER RPC (stamps the caller's own identity server-side so rows cannot be forged); enabled RLS with own-practice and super-admin read policies. The table is **append-only by design** — no UPDATE or DELETE policy is granted, satisfying the integrity requirement (§164.312(c)(1)).

2. **F-2 — Scheduled the purge job.** Registered the `purge-consult-audio` cron job to run daily at 08:00 UTC, invoking the retention function that deletes audio older than each practice's retention window (default 30 days), nulls the storage path, and stamps `audio_deleted_at`. Transcripts and analysis are retained; only the raw audio is destroyed.

3. **F-3 — Added deletion logging.** Updated the purge function to write a `recording.purged` audit row (with `phi_accessed = true`, practice attribution, object path, retention window, and record age) for every deletion. Best-effort and non-blocking, attributed to the system actor.

Code changes recorded in the repository: `supabase/functions/purge-consult-audio/index.ts` and `supabase/apply_cron.sql`.

---

## 6. Verification

**Independently confirmed against the live database after remediation (2026-06-09):**

- **F-1 confirmed remediated.** The `audit_logs` columns `phi_accessed`, `details`, and `user_agent` — which returned "column does not exist" (`42703`) before remediation — now resolve successfully. The `log_audit_event()` RPC exists and resolves unambiguously for the application's call signature; execution is correctly restricted to authenticated callers (anonymous calls are denied).
- **F-2 / F-3 applied.** The `purge-consult-audio` cron schedule (daily 08:00 UTC) and the deletion-logging code change were applied. Operator-side confirmation recommended for the record:
  - `select jobname, schedule, active from cron.job where jobname = 'purge-consult-audio';`
  - After the first run, confirm `recording.purged` rows appear: `select created_at, practice_id, resource_id, details from public.audit_logs where action = 'recording.purged' order by created_at desc;`

---

## 7. Residual / accepted risks

- `avatars` and `reseller-assets` remain public. Both were inspected and contain no ePHI (staff profile photos and branding assets only). Public exposure is accepted; revisit if patient-identifiable images are ever stored there.
- This project applies database changes via the Supabase SQL editor rather than `supabase db push`; the migration-tracking table is not a reliable record of live state. Live verification (as used in this audit) should be repeated for future storage/RLS changes.
- A stale duplicate `log_audit_event()` overload (from an earlier out-of-band definition) exists in the live catalog. It does **not** affect functionality — the application's full-parameter call resolves unambiguously to the current function. Optional housekeeping: drop the stale overload to keep the catalog clean. No compliance impact.

---

**Prepared by:** Automated security audit (Claude Code), reviewed by devyntgrillo@gmail.com
**Record date:** 2026-06-09
