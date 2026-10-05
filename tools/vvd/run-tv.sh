#!/usr/bin/env bash
# Build the latest WordLight TV app and launch it on the Vega Virtual Device (or a connected Fire TV with --device).
#   bash tools/vvd/run-tv.sh [--device <id>] [--no-build] [--logs]
# Prerequisites (once): bash apps/vega-tv/setup.sh. A WordLight server must be running (npm start, or
# tools/demo/local-demo.sh for the local simulation).
set -euo pipefail
cd "$(dirname "$0")/../.."
DEVICE=VirtualDevice; BUILD=1; LOGS=0
while [ $# -gt 0 ]; do case "$1" in --device) DEVICE="$2"; shift 2;; --no-build) BUILD=0; shift;; --logs) LOGS=1; shift;; *) echo "unknown $1"; exit 2;; esac; done
[ -f "$HOME/vega/env" ] && source "$HOME/vega/env"
command -v vega >/dev/null || { echo "Vega CLI not found (source ~/vega/env)"; exit 1; }
curl -sf -o /dev/null http://localhost:8787/healthz || echo "WARNING: no WordLight server on :8787 — start npm start or tools/demo/local-demo.sh"
bash apps/vega-tv/sync.sh
APP=apps/vega-tv/WordLightTV
if [ $BUILD = 1 ]; then (cd "$APP" && npx tsc --noEmit -p tsconfig.json && npm run build:debug); fi
ARCH=$(uname -m); case "$ARCH" in arm64|aarch64) A=aarch64;; *) A=x86_64;; esac
[ "$DEVICE" != VirtualDevice ] && A=armv7 && echo "physical device: using the armv7 build (check 'vega device info' if it differs)"
VPKG=$(ls "$APP"/build/${A}-debug/*.vpkg | head -1)
if [ "$DEVICE" = VirtualDevice ]; then vega virtual-device status 2>/dev/null | grep -qi running || vega virtual-device start; fi
vega run-app "$VPKG" com.wordlight.tv.main -d "$DEVICE"
echo "launched $(basename "$VPKG") on $DEVICE"
[ $LOGS = 1 ] && vega device start-log-stream --device "$DEVICE" | grep --line-buffered -i wordlight
