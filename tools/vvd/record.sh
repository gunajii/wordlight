#!/usr/bin/env bash
# Review recording of a demo run on the Vega Virtual Device (macOS): a screen video plus a full-resolution still
# every few seconds, so the session can inspect the TV UI (readability, Devanagari, focus, green/amber, ✓, end card).
#   bash tools/vvd/record.sh [seconds=180] [still-interval=3]
# Output: .dev/rec/<stamp>/screen.mov + still-NNN.png (local only; .dev/ is git-ignored). Main display only.
# Needs Screen Recording permission for Terminal (System Settings › Privacy & Security › Screen Recording); without
# it macOS records only the wallpaper. Turn on Do Not Disturb first: everything on screen is captured.
set -uo pipefail
cd "$(dirname "$0")/../.."
SECS=${1:-180}; EVERY=${2:-3}
OUT=.dev/rec/$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
screencapture -x "$OUT/still-000.png" || { echo "screencapture failed (Screen Recording permission for Terminal?)"; exit 1; }
screencapture -x -V "$SECS" "$OUT/screen.mov" & VPID=$!
trap 'kill -INT $VPID 2>/dev/null; STOP=1' INT
STOP=0; i=1
echo "Recording up to ${SECS}s to $OUT (still every ${EVERY}s). Ctrl-C stops early."
while [ $STOP = 0 ] && kill -0 $VPID 2>/dev/null; do
  screencapture -x "$OUT/still-$(printf %03d $i).png"; i=$((i+1)); sleep "$EVERY"
done
wait $VPID 2>/dev/null
echo "done: $(ls "$OUT"/still-*.png | wc -l | tr -d ' ') stills, video $(du -h "$OUT/screen.mov" 2>/dev/null | cut -f1) → $OUT"
