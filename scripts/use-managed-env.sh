#!/usr/bin/env bash
# Point local dev at managed Supabase (frontend .env.local only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_REF="eymgqjeudrmeofytnwgs"
URL="https://${PROJECT_REF}.supabase.co"

ANON="${VITE_SUPABASE_ANON_KEY:-}"
if [[ -z "$ANON" ]]; then
  echo "Set VITE_SUPABASE_ANON_KEY or pass ANON_KEY=... (Dashboard → Settings → API → anon public)" >&2
  echo "Example: ANON_KEY='eyJ...' $0" >&2
  exit 1
fi

cat > "$ROOT/.env.local" <<EOF
# Managed Supabase — project ${PROJECT_REF}
VITE_SUPABASE_URL=${URL}
VITE_SUPABASE_ANON_KEY=${ANON}
EOF
chmod 600 "$ROOT/.env.local" 2>/dev/null || true
echo "Wrote $ROOT/.env.local → ${URL}"
