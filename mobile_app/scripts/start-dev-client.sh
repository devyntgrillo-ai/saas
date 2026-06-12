#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${REACT_NATIVE_PACKAGER_HOSTNAME:-}" ]; then
  REACT_NATIVE_PACKAGER_HOSTNAME="$(
    ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1)}'
  )"
fi

if [ -z "${REACT_NATIVE_PACKAGER_HOSTNAME:-}" ]; then
  REACT_NATIVE_PACKAGER_HOSTNAME="$(hostname -I | awk '{print $1}')"
fi

export REACT_NATIVE_PACKAGER_HOSTNAME

echo "CaseLift dev client → http://${REACT_NATIVE_PACKAGER_HOSTNAME}:8081"
echo "(Set REACT_NATIVE_PACKAGER_HOSTNAME to override.)"

exec npx expo start --dev-client --host lan "$@"
