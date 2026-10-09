#!/usr/bin/env bash
# Capture the Vega Virtual Device's screen every few seconds into .dev/shots/ (git-ignored) until Ctrl-C, so a full
# demo run can be reviewed frame by frame afterwards. Uses the device's gwsi-tool-screenshooter via `vega device run-cmd`
# and `vega device copy-from`.
#   cd ~/Projects/wordlight && bash tools/vvd/shots.sh [seconds between shots, default 2]
set -uo pipefail
cd "$(dirname "$0")/../.."
[ -f "$HOME/vega/env" ] && source "$HOME/vega/env"
command -v vega >/dev/null || { echo "Vega CLI not found (source ~/vega/env)"; exit 1; }
DEV="${DEVICE:-VirtualDevice}"
OUT=.dev/shots/$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
echo "capturing to $OUT every ${1:-2} s — Ctrl-C to stop"
n=0
while true; do
  t=$(date +%H%M%S)
  # `vega exec vda …` does not see the Virtual Device here ("no devices/emulators found"); the vega device
  # commands do (they are what run-tv.sh uses)
  if E1=$(vega device run-cmd --device "$DEV" --command "gwsi-tool-screenshooter /tmp/wl-shot.png" 2>&1) \
     && E2=$(vega device copy-from --device "$DEV" --source /tmp/wl-shot.png --destination "$OUT/$t.png" 2>&1) \
     && [ -s "$OUT/$t.png" ]; then
    n=$((n+1)); printf '\r%d shots (last %s)' "$n" "$t"
  else
    echo; echo "capture failed at $t:"; echo "  screenshooter: ${E1:-}" | head -5; echo "  pull: ${E2:-}" | head -5
    [ -n "${DEBUGGED:-}" ] || { DEBUGGED=1; echo "--- vega device list:"; vega device list 2>&1 | head -5; ls -la "$OUT" | head -5; }
    sleep 3
  fi
  sleep "${1:-2}"
done
