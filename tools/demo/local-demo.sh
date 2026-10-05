#!/usr/bin/env bash
# LOCAL DEMO MODE — the whole product on the Mac + Vega Virtual Device, with NO AWS: speech recognition is a
# SCRIPTED SIMULATION (the TV and phone show "SIMULATED SPEECH"). For development and rehearsal only — never present
# a recording of this mode as Amazon Transcribe.
#   bash tools/demo/local-demo.sh [--real-phone] [--echo] [--script demo|rotate|correct|misread|correction|stall]
# Starts: the server (SPEECH=scripted, test story on the shelf), the https dev tunnel (Vega's player needs https
# media), and — unless --real-phone — a scripted reader "Riya" that joins the TV's session (no microphone at all).
# With --real-phone, an ADULT may scan the QR; the tunnel is a development path: never a child's voice.
# Then: bash tools/vvd/run-tv.sh   (builds and launches the TV app on the Vega Virtual Device)
set -euo pipefail
cd "$(dirname "$0")/../.."
REAL=0; MODE=free; SCRIPT=demo
while [ $# -gt 0 ]; do case "$1" in --real-phone) REAL=1; shift;; --echo) MODE=echo; shift;; --script) SCRIPT="$2"; shift 2;; *) echo "unknown $1"; exit 2;; esac; done
mkdir -p .dev
[ -s content/stories/wl-test-kite/p1.mp3 ] || { python3 tools/content/make-test-art.py && node tools/content/build-story.ts wl-test-kite --narration fixture; }
node tools/content/validate-story.ts >/dev/null || { node tools/content/validate-story.ts; exit 1; }
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
echo "== server (SPEECH=scripted · $SCRIPT · READING_MODE=$MODE) — LOCAL SIMULATION"
SPEECH=scripted SPEECH_SCRIPT="$SCRIPT" READING_MODE="$MODE" SHOW_TEST_CONTENT=1 node server/src/index.ts > .dev/local-demo-server.log 2>&1 & pids+=($!)
for i in $(seq 1 40); do curl -sf -o /dev/null http://localhost:8787/healthz && break; sleep 0.25; done
curl -sf http://localhost:8787/api/config; echo
if [ ! -s .dev/media-url ] || ! curl -sf -o /dev/null --max-time 5 "$(cat .dev/media-url)/healthz"; then
  echo "== https dev tunnel (for the TV's media player)"; bash tools/dev-tunnel/dev-tunnel.sh > .dev/local-demo-tunnel.log 2>&1 & pids+=($!)
  for i in $(seq 1 120); do grep -q READY .dev/local-demo-tunnel.log 2>/dev/null && break; sleep 1; done
fi
echo "media: $(cat .dev/media-url 2>/dev/null || echo NONE)"
if [ $REAL = 0 ]; then
  echo "== scripted reader (waits for the TV app to open a session)"
  node tools/demo/fake-reader.ts --url http://localhost:8787 & pids+=($!)
fi
echo "Ready. Now run in another terminal:  bash tools/vvd/run-tv.sh      (Ctrl-C here stops everything)"
wait
