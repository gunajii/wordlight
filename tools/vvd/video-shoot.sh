#!/usr/bin/env bash
# One command to film the TV for the demo video (macOS + Vega Virtual Device + the AWS server):
#   cd ~/Projects/wordlight && bash tools/vvd/video-shoot.sh [minutes=12]
# 1. deploys the latest code to the AWS server (infra/aws/deploy.sh also starts it if stopped), waits until healthy;
# 2. launches the WordLight TV app on the Virtual Device (builds it only if no build exists; BUILD=1 forces a build);
# 3. records for N minutes: a video of the Virtual Device window plus a still every 2 s (tools/vvd/record.sh) AND
#    clean full-resolution frames from the device itself every 2 s (tools/vvd/shots.sh).
# Output: .dev/rec/<stamp>/ and .dev/shots/<stamp>/ (git-ignored). Ctrl-C stops early and still saves.
# While it records, Claude drives the TV with the remote keys (computer use); you only need the phone for turns.
set -uo pipefail
cd "$(dirname "$0")/../.."
MIN=${1:-12}; SECS=$((MIN * 60))
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER=""
[ -f "$HOME/vega/env" ] && source "$HOME/vega/env"
fail() { echo; echo "VIDEO-SHOOT STOPPED: $*"; echo "tell Claude \"shoot stopped\" (and paste the line above)"; exit 1; }
command -v vega >/dev/null || fail "Vega CLI not found (source ~/vega/env)"
aws sts get-caller-identity --query Account --output text >/dev/null 2>&1 || fail "AWS sign-in expired: run 'aws login', then this again"
URL=$(grep -oE "https://[0-9-]+\.sslip\.io" apps/vega-tv/WordLightTV/src/wordlight.config.ts | head -1)
[ -n "$URL" ] || fail "no AWS server URL in the TV config (run apps/vega-tv/setup.sh with SERVER_URL)"
echo "== 1. server ($URL)"
bash infra/aws/deploy.sh || fail "deploy failed"
for i in $(seq 1 40); do curl -sf -m 5 "$URL/healthz" >/dev/null && break; sleep 5; done
curl -sf -m 5 "$URL/healthz" || fail "server not healthy at $URL/healthz after ~3 min"
echo; echo "stories on the server: $(curl -sf "$URL/api/stories" | python3 -c 'import json,sys; print(", ".join(s["title"] for s in json.load(sys.stdin)))')"
echo "== 2. TV app"
ARGS=(); ls apps/vega-tv/WordLightTV/build/*-debug/*.vpkg >/dev/null 2>&1 && [ "${BUILD:-0}" != 1 ] && ARGS=(--no-build)
SERVER_URL="$URL" bash tools/vvd/run-tv.sh ${ARGS[@]+"${ARGS[@]}"} > .dev/video-shoot-tv.log 2>&1 &
TVPID=$!
for i in $(seq 1 60); do grep -q "^launched" .dev/video-shoot-tv.log 2>/dev/null && break; kill -0 $TVPID 2>/dev/null || break; sleep 3; done
grep -q "^launched" .dev/video-shoot-tv.log || { tail -15 .dev/video-shoot-tv.log; fail "the TV app did not launch (log: .dev/video-shoot-tv.log)"; }
echo "launched; giving the app 8 s"; sleep 8
echo "== 3. recording ${MIN} min — tell Claude \"recording\" now"
bash tools/vvd/shots.sh 2 > .dev/video-shoot-shots.log 2>&1 &
SHPID=$!
trap 'kill -INT $SHPID 2>/dev/null' INT TERM
bash tools/vvd/record.sh "$SECS" 2
kill -INT $SHPID 2>/dev/null; sleep 1; kill $SHPID 2>/dev/null
echo; echo "== done. Recording: $(ls -td .dev/rec/* | head -1) · device frames: $(ls -td .dev/shots/* | head -1)"
echo "tell Claude \"shoot done\""
