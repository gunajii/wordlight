#!/usr/bin/env bash
# PHASE C — storyteller narration. ~10 min; ≈ USD 0.30 (INFERRED: Polly neural + generative ≈ 10k chars, Transcribe ≈ 6 min).
#   cd ~/Projects/wordlight && bash tools/aws/phase-c.sh
# 1. align-check: can the expressive generative English voice (no speech marks) get word timings from Transcribe
#    that are as good as Polly's marks? Decision rule is in tools/s4/align-check.ts (fixed before the run).
# 2. rebuild the stories: English generative if adopted (otherwise neural style #3), Hindi neural style #3
#    (rate 90 %, +6 dB, 650 ms between lines — the style chosen by listening on 2026-10-08).
# 3. deploy the new narration to the server (runtime settings unchanged: echo mode etc.).
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER="" USAGE_FILE="$PWD/.dev/usage.json"
STAMP=$(date -u +%Y%m%dT%H%M%SZ); LOG=".dev/aws/phase-c-$STAMP.log"; mkdir -p .dev/aws
exec > >(tee -a "$LOG") 2>&1
fail() { echo; echo "PHASE C STOPPED: $*"; echo "log: $LOG — tell Claude \"phase C stopped\""; exit 1; }
aws sts get-caller-identity --query Account --output text >/dev/null || fail "no AWS credentials in this terminal (aws login)"
echo "== 1. generative timing check (Busy Ants, 10 pages, ~6 min: Transcribe listens in real time)"
node tools/s4/align-check.ts --story busy-ants || fail "align-check failed"
ADOPT=$(node -e 'console.log(require("./.dev/aws/align-decision.json").adopt)')
EN=""; [ "$ADOPT" = true ] && EN="--narration generative"
echo "== 2. stories (English: ${EN:-neural style #3}; Hindi: neural style #3)"
node tools/content/build-story.ts busy-ants $EN || fail "busy-ants build failed"
node tools/content/build-story.ts wl-test-kite $EN || fail "wl-test-kite build failed"
node tools/content/build-story.ts busy-ants-hi || fail "busy-ants-hi build failed"
node tools/content/validate-story.ts || fail "story validation failed"
echo "== 3. deploy"
bash infra/aws/deploy.sh || fail "deploy failed"
node tools/aws/cost-report.ts
echo; echo "Phase C complete. Log: $LOG"
echo "Next: bash tools/aws/phase-b.sh (rebuilds the TV app with the help-word fix) — then tell Claude \"phase C done\""
