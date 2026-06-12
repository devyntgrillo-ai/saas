#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${REACT_NATIVE_PACKAGER_HOSTNAME:-}" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    for iface in en0 en1; do
      REACT_NATIVE_PACKAGER_HOSTNAME="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      [ -n "${REACT_NATIVE_PACKAGER_HOSTNAME:-}" ] && break
    done
  else
    REACT_NATIVE_PACKAGER_HOSTNAME="$(
      ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1)}'
    )"
    if [ -z "${REACT_NATIVE_PACKAGER_HOSTNAME:-}" ]; then
      REACT_NATIVE_PACKAGER_HOSTNAME="$(hostname -I | awk '{print $1}')"
    fi
  fi
fi

export REACT_NATIVE_PACKAGER_HOSTNAME

echo "CaseLift dev client → http://${REACT_NATIVE_PACKAGER_HOSTNAME}:8081"
echo "(Set REACT_NATIVE_PACKAGER_HOSTNAME to override.)"

exec npx expo start --dev-client --host lan "$@"
