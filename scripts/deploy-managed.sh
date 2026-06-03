#!/usr/bin/env bash
# Push migrations + deploy edge functions to managed project eymgqjeudrmeofytnwgs.
#
# Prerequisites:
#   npx supabase login
#   # or: export SUPABASE_ACCESS_TOKEN=sbp_...
#
# Usage:
#   ./scripts/deploy-managed.sh
#   ./scripts/deploy-managed.sh --db-only
#   ./scripts/deploy-managed.sh --functions-only
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROJECT_REF="eymgqjeudrmeofytnwgs"

SB() { if command -v supabase >/dev/null 2>&1; then supabase "$@"; else npx supabase "$@"; fi; }

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  if ! SB projects list >/dev/null 2>&1; then
    echo "Not logged in. Run:" >&2
    echo "  npx supabase login" >&2
    echo "  # or export SUPABASE_ACCESS_TOKEN=your-token" >&2
    exit 1
  fi
fi

echo "→ Linking project $PROJECT_REF"
SB link --project-ref "$PROJECT_REF" --yes 2>/dev/null || SB link --project-ref "$PROJECT_REF"

DB_ONLY=false
FN_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --db-only) DB_ONLY=true ;;
    --functions-only) FN_ONLY=true ;;
  esac
done

if [[ "$FN_ONLY" != true ]]; then
  echo "→ Pushing database migrations"
  SB db push
fi

if [[ "$DB_ONLY" != true ]]; then
  echo "→ Deploying edge functions"
  for dir in supabase/functions/*/; do
    name="$(basename "$dir")"
    [[ "$name" == "_shared" ]] && continue
    [[ -f "$dir/index.ts" ]] || continue
    extra=(--project-ref "$PROJECT_REF")
    if [[ -f "$dir/config.toml" ]] && grep -qE 'verify_jwt\s*=\s*false' "$dir/config.toml" 2>/dev/null; then
      extra+=(--no-verify-jwt)
    fi
    echo "  · $name ${extra[*]}"
    SB functions deploy "$name" "${extra[@]}"
  done
fi

echo ""
echo "Done. Frontend should use:"
echo "  VITE_SUPABASE_URL=https://${PROJECT_REF}.supabase.co"
echo "  (see .env.local)"
echo ""
echo "If cron jobs need DB settings, run supabase/apply_cron.sql in the SQL editor"
echo "with your service_role key (see SEQUENCE_SCHEDULING.md)."
