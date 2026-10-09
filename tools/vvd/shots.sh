#!/usr/bin/env bash
# Capture the Vega Virtual Device's screen every few seconds into .dev/shots/ (git-ignored) until Ctrl-C, so a full
# demo run can be reviewed frame by frame afterwards. Uses the Vega device tools (gwsi-tool-screenshooter + vda pull).
#   cd ~/Projects/wordlight && bash tools/vvd/shots.sh [seconds between shots, default 2]
set -uo pipefail
cd "$(dirname "$0")/../.."
[ -f "$HOME/vega/env" ] && source "$HOME/vega/env"
command -v vega >/dev/null || { echo "Vega CLI not found (source ~/vega/env)"; exit 1; }
OUT=.dev/shots/$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
echo "capturing to $OUT every ${1:-2} s — Ctrl-C to stop"
n=0
while true; do
  t=$(date +%H%M%S)
  if vega exec vda shell gwsi-tool-screenshooter /tmp/wl-shot.png >/dev/null 2>&1 \
     && (cd "$OUT" && vega exec vda pull /tmp/wl-shot.png >/dev/null 2>&1 && mv wl-shot.png "$t.png"); then
    n=$((n+1)); printf '\r%d shots (last %s)' "$n" "$t"
  else printf '\rcapture failed at %s (is the Virtual Device running?)   ' "$t"; fi
  sleep "${1:-2}"
done
