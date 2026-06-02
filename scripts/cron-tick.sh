#!/usr/bin/env bash
# Local dev: run sequence activation + sender without pg_cron.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f supabase/.env.local ]]; then
  # shellcheck disable=SC1091
  set -a && source supabase/.env.local && set +a
fi

URL="${SUPABASE_URL:-}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [[ -z "$URL" || -z "$KEY" ]]; then
  if command -v supabase >/dev/null 2>&1; then
    eval "$(supabase status -o env 2>/dev/null || true)"
    URL="${API_URL:-$SUPABASE_URL}"
    KEY="${SERVICE_ROLE_KEY:-$SUPABASE_SERVICE_ROLE_KEY}"
  fi
fi

if [[ -z "$URL" || -z "$KEY" ]]; then
  echo "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or run: supabase start)" >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${KEY}" -H "Content-Type: application/json")

echo "→ process-sequences"
curl -sS -X POST "${URL}/functions/v1/process-sequences" "${auth[@]}" -d '{"tick":true}'
echo ""
echo "→ send-due-messages"
curl -sS -X POST "${URL}/functions/v1/send-due-messages" "${auth[@]}" -d '{"tick":true}'
echo ""
