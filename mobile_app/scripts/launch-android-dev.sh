#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DEVICE="${ANDROID_SERIAL:-10.51.214.103:33035}"
PORT="${METRO_PORT:-8081}"

if [ -z "${REACT_NATIVE_PACKAGER_HOSTNAME:-}" ]; then
  REACT_NATIVE_PACKAGER_HOSTNAME="$(
    ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") print $(i + 1)}'
  )"
fi
if [ -z "${REACT_NATIVE_PACKAGER_HOSTNAME:-}" ]; then
  REACT_NATIVE_PACKAGER_HOSTNAME="$(hostname -I | awk '{print $1}')"
fi

BUNDLE_URL="http://${REACT_NATIVE_PACKAGER_HOSTNAME}:${PORT}"
ENCODED="$(python3 -c "import urllib.parse; print(urllib.parse.quote('${BUNDLE_URL}', safe=''))")"

echo "Launching dev client → ${BUNDLE_URL}"

adb -s "$DEVICE" shell am force-stop com.caselift.mobile
sleep 1
adb -s "$DEVICE" shell am start -a android.intent.action.VIEW \
  -d "exp+caselift-mobile://expo-development-client/?url=${ENCODED}"
