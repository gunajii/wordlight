#!/usr/bin/env bash
# One-command S1 timing run on the Mac: screen+mic recording, TV log capture, and the run itself — no clicks.
#
#   bash tools/s1-run/s1-run.sh <label> [--audio p1.m4a|p1.mp3] [--lead <ms>] [--seconds N]
#   bash tools/s1-run/s1-run.sh <label> --chain        # measures the Mac's own recording chain (no Vega)
#
# TV mode needs: `npm start` running, tools/dev-tunnel/dev-tunnel.sh running, and the WordLight app OPEN on the
# Vega Virtual Device (any screen). The script writes .dev/tv.json with a new runId; the app polls /api/config,
# sees the new run and plays the S1 story from 0 with that audio file and lead (no rebuild, relaunch or key press).
# Output (gitignored): recordings/<label>.mov, recordings/<label>.log, recordings/<label>.done
# Analysis: python3 tools/audio-analysis/av_offset.py recordings/<label>.mov
# First use: macOS asks to allow Screen Recording (and Microphone) for your terminal app; allow and re-run.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
LABEL="${1:?usage: s1-run.sh <label> [--audio p1.m4a] [--lead ms] [--seconds N] [--chain]}"; shift
AUDIO=p1.m4a; LEAD=0; MODE=tv; SECS=215  # 205 s cut off the last 11 words in run cal-m4a
while [ $# -gt 0 ]; do case "$1" in
  --audio) AUDIO="$2"; shift 2;; --lead) LEAD="$2"; shift 2;; --seconds) SECS="$2"; shift 2;;
  --chain) MODE=chain; SECS=80; shift;; *) echo "unknown option $1"; exit 2;; esac; done
[[ "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "label: letters, digits, . _ - only"; exit 2; }
OUT="recordings/$LABEL"; mkdir -p recordings .dev; rm -f "$OUT.done"
LOGPID=""
cleanup() { [ -n "$LOGPID" ] && { kill "$LOGPID" 2>/dev/null; pkill -f "start-log-stream --device VirtualDevice" 2>/dev/null; }; }
trap cleanup EXIT

if [ "$MODE" = tv ]; then
  curl -sf -o /dev/null http://localhost:8787/healthz || { echo "server not running — run: npm start"; exit 1; }
  [ -s .dev/media-url ] || { echo "no https media URL — run: bash tools/dev-tunnel/dev-tunnel.sh"; exit 1; }
  # shellcheck disable=SC1090
  source ~/vega/env
  ( vega device start-log-stream --device VirtualDevice 2>&1 | grep --line-buffered -i wordlight > "$OUT.log" ) &
  LOGPID=$!
else
  [ -s recordings/chain-check.mp4 ] || { echo "recordings/chain-check.mp4 missing"; exit 1; }
fi

echo "Recording $SECS s → $OUT.mov (whole screen + default microphone). Keep the Mac quiet, volume ~70%, speakers on."
screencapture -v -V "$SECS" -g "$OUT.mov" &
CAP=$!
sleep 3
kill -0 $CAP 2>/dev/null || { echo "screencapture exited at once — allow Screen Recording/Microphone for this terminal app, then re-run"; exit 1; }

if [ "$MODE" = tv ]; then
  RUN="$LABEL-$(date +%s)"
  printf '{"runId":"%s","audioFile":"%s","leadMs":%s,"autorun":true}\n' "$RUN" "$AUDIO" "$LEAD" > .dev/tv.json
  echo "Run $RUN: audio $AUDIO, lead $LEAD ms"
  for _ in $(seq 10); do grep -q "autorun" "$OUT.log" 2>/dev/null && break; sleep 1; done
  grep -q "autorun" "$OUT.log" 2>/dev/null && echo "TV app picked it up." || echo "WARNING: no 'autorun' in the TV log after 10 s — is the WordLight app open on the Virtual Device (and built after 2026-09-30 18:50)?"
else
  open -a "QuickTime Player" "$ROOT/recordings/chain-check.mp4"; sleep 2
  osascript -e 'tell application "QuickTime Player" to play document 1' || echo "press play in QuickTime now"
fi

wait $CAP
echo "{\"label\":\"$LABEL\",\"mode\":\"$MODE\",\"audio\":\"$AUDIO\",\"leadMs\":$LEAD,\"finished\":\"$(date -u +%FT%TZ)\"}" > "$OUT.done"
echo "Done: $OUT.mov$([ "$MODE" = tv ] && echo " and $OUT.log")"
