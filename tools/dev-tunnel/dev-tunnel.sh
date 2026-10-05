#!/usr/bin/env bash
# HTTPS for local development: Vega's media player refuses http:// media (docs/FRICTION_LOG.md W5), and phone
# browsers only open the microphone on https pages. This runs a Cloudflare quick tunnel (no account) to the local
# server and writes its URL to .dev/media-url, which the server hands to the TV at /api/config — so a new tunnel
# URL needs no rebuild. Quick tunnels die when the Mac sleeps or changes network ("Unauthorized: Tunnel not
# found"); this script then starts a fresh one and updates the file.
#
# Dev only. Traffic passes through Cloudflare. Do NOT send child audio through it; see docs/PRIVACY.md.
# Usage: bash tools/dev-tunnel/dev-tunnel.sh   (leave running; server must be on localhost:8787)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-8787}"
mkdir -p "$ROOT/.dev" "$ROOT/recordings"
LOG="$ROOT/recordings/tunnel.log"
command -v cloudflared >/dev/null || { echo "cloudflared missing: brew install cloudflared"; exit 1; }
trap 'kill $CF 2>/dev/null; rm -f "$ROOT/.dev/media-url"; exit' INT TERM
while true; do
  : > "$LOG"
  echo "$(date +%T) starting a Cloudflare quick tunnel to localhost:$PORT …"
  cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >>"$LOG" 2>&1 &
  CF=$!
  URL=""
  for _ in $(seq 60); do URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1); [ -n "$URL" ] && break; sleep 1; done
  if [ -z "$URL" ]; then echo "$(date +%T) no tunnel URL after 60 s; retrying"; kill $CF 2>/dev/null; sleep 5; continue; fi
  # wait until the tunnel actually answers (DNS for a new quick tunnel can take up to a minute)
  echo "$(date +%T) tunnel $URL created — waiting until it answers (can take ~1 min; do not stop this)…"
  for _ in $(seq 30); do curl -sf -o /dev/null "$URL/healthz" && break; sleep 2; done
  echo "$URL" > "$ROOT/.dev/media-url"
  echo "$(date +%T) READY — https URL for the TV and phones: $URL  (leave this running)"
  # watch for death: process exit or the server-side 'Tunnel not found' after sleep
  while kill -0 $CF 2>/dev/null; do
    if [ "$(grep -c 'Tunnel not found' "$LOG")" -ge 3 ]; then echo "$(date +%T) tunnel lost; starting a new one"; kill $CF; break; fi
    sleep 5
  done
  rm -f "$ROOT/.dev/media-url"
  sleep 2
done
