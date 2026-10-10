#!/usr/bin/env bash
# Review recording of a demo run on the Vega Virtual Device (macOS): a video plus a full-resolution still every few
# seconds of the Virtual Device WINDOW only (found with tools/vvd/vvd-window.js), so the session can inspect the TV UI
# (readability, Devanagari, focus, green/amber, ✓, end card). Stills capture the window even when something covers it;
# the video records the window's rectangle. If the window is not found, the whole main display is recorded instead.
#   bash tools/vvd/record.sh [seconds=180] [still-interval=3]
# Output: .dev/rec/<stamp>/screen.mov + still-NNN.png (local only; .dev/ is git-ignored).
# Needs Screen Recording permission for Terminal (System Settings › Privacy & Security › Screen Recording); without
# it macOS records only the wallpaper.
set -uo pipefail
cd "$(dirname "$0")/../.."
SECS=${1:-180}; EVERY=${2:-3}
OUT=.dev/rec/$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
WIN=""; for _ in $(seq 1 10); do WIN=$(osascript -l JavaScript tools/vvd/vvd-window.js 2>/dev/null || true); [ -n "$WIN" ] && break; sleep 2; done
if [ -n "$WIN" ]; then
  read -r WID WX WY WW WH <<< "$WIN"
  STILL=(-o -l "$WID"); VIDEO=(-R "$WX,$WY,$WW,$WH"); WINDOW=1
  echo "Virtual Device window $WID at $WX,$WY ${WW}×$WH — recording only that window"
else
  STILL=(); VIDEO=(); WINDOW=0; echo "Virtual Device window not found — recording the whole main display"
fi
screencapture -x ${STILL[@]+"${STILL[@]}"} "$OUT/still-000.png" || { echo "screencapture failed (Screen Recording permission for Terminal?)"; exit 1; }
# job control on: otherwise a script's background child ignores SIGINT, and SIGINT is how screencapture stops and saves
START=$(date +%s)
set -m; screencapture -x ${VIDEO[@]+"${VIDEO[@]}"} -V "$SECS" "$OUT/screen.mov" & VPID=$!; set +m
sleep 1
if ! kill -0 $VPID 2>/dev/null && [ "$WINDOW" = 1 ]; then   # window-rectangle video refused: whole display instead
  echo "window-only video not supported here — video of the whole main display (stills stay window-only)"
  set -m; screencapture -x -V "$SECS" "$OUT/screen.mov" & VPID=$!; set +m
fi
trap 'kill -INT $VPID 2>/dev/null; STOP=1' INT TERM
STOP=0; i=1
echo "Recording up to ${SECS}s to $OUT (still every ${EVERY}s). Ctrl-C stops early."
while [ $STOP = 0 ] && [ $(( $(date +%s) - START )) -lt "$SECS" ]; do
  screencapture -x ${STILL[@]+"${STILL[@]}"} "$OUT/still-$(printf %03d $i).png"; i=$((i+1)); sleep "$EVERY"
done
wait $VPID 2>/dev/null
echo "done: $(ls "$OUT"/still-*.png | wc -l | tr -d ' ') stills, video $(du -h "$OUT/screen.mov" 2>/dev/null | cut -f1) → $OUT"
