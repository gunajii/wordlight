#!/usr/bin/env bash
# PHASE A2 — follow-up to phase A's S2 FAIL (mostly latency) and Bedrock AccessDenied. ~30 min; ≈ USD 1 (INFERRED:
# Transcribe ≈ 30 min of audio, Polly ≈ 5k chars (cached after the first run), a handful of Bedrock calls).
#   cd ~/Projects/wordlight && bash tools/aws/phase-a2.sh          [--no-deploy]
# 1. Bedrock: one bare call per model with the error message kept verbatim; the benchmark reruns if a call works.
# 2. S2 on the same 40-case sample, 5 configurations: the phase-A setting repeated (run-to-run spread), then 600 ms of
#    silence before the speech (as on a real phone) with stability high / medium / low / none.
# 3. The best configuration by the rule in tools/s2/compare.ts (fixed before the runs) is re-measured on all 169 cases.
# 4. Redeploy only if something changed: READING_MODE from the 169-case verdict (PASS → free, otherwise echo),
#    TRANSCRIBE_STABILITY from step 3, the Bedrock coach if a model qualified.
# The S2 metric and its pass rule are not changed. Every run is kept in docs/results/s2/, including the worse ones.
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER="" USAGE_FILE="$PWD/.dev/usage.json"
DEPLOY=1; for a in "$@"; do [ "$a" = --no-deploy ] && DEPLOY=0; done
mkdir -p .dev/aws
STAMP=$(date -u +%Y%m%dT%H%M%SZ); LOG=".dev/aws/phase-a2-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
step() { echo; echo "=================== $* ==================="; }
fail() { echo; echo "PHASE A2 STOPPED: $*"; echo "log: $LOG — tell Claude \"phase A2 stopped\""; exit 1; }

step "0. account and spend so far"
aws sts get-caller-identity --query Account --output text >/dev/null || fail "no AWS credentials in this terminal (aws login)"
node tools/aws/cost-report.ts

step "1. Bedrock — why AccessDenied? (one bare call each, message verbatim)"
BED_OK=0
for M in apac.amazon.nova-micro-v1:0 amazon.nova-micro-v1:0 apac.amazon.nova-lite-v1:0 mistral.ministral-3-3b-instruct; do
  echo "--- $M"
  if aws bedrock-runtime converse --region "$AWS_REGION" --model-id "$M" --messages '[{"role":"user","content":[{"text":"Say OK."}]}]' \
       --inference-config '{"maxTokens":5}' --query 'output.message.content[0].text' --output text 2>&1; then BED_OK=1; fi
done
aws bedrock get-foundation-model-availability --region "$AWS_REGION" --model-id amazon.nova-micro-v1:0 --output json 2>&1 | head -20 || true
if [ $BED_OK = 1 ]; then
  node tools/bedrock/bench.ts --candidates .dev/aws/bedrock-candidates.json --max 5 || echo "(benchmark failed — template stays)"
else echo "Bedrock still refused — the template summary stays. (Error text above goes into the friction log.)"; fi

step "2. S2 experiment — 40-case sample × 5 configurations (~12 min)"
DIRS=""
run() { # stability lead tag
  node tools/s2/eval.ts --engine polly-transcribe --sample 40 --stability "$1" --lead-silence-ms "$2" --tag "$3" | tail -3 || fail "S2 run $3 failed"
  DIRS="$DIRS $(ls -d docs/results/s2/polly-transcribe-*-"$3" | sort | tail -1)"
}
run high 0 s40-high-lead0
run high 600 s40-high-lead600
run medium 600 s40-medium-lead600
run low 600 s40-low-lead600
run none 600 s40-none-lead600
OUT="docs/results/s2/experiment-$STAMP.md"
BEST=$(node tools/s2/compare.ts --out "$OUT" $DIRS | tee /dev/stderr | tail -1 | awk '{print $2}')
echo "chosen stability: $BEST (table: $OUT)"

step "3. S2 — all 169 cases with stability $BEST and 600 ms lead silence (~15 min)"
node tools/s2/eval.ts --engine polly-transcribe --stability "$BEST" --lead-silence-ms 600 --tag "full-$BEST-lead600" | tail -3 || fail "full S2 run failed"
FULL=$(ls -d docs/results/s2/polly-transcribe-*-full-"$BEST"-lead600 | sort | tail -1)
VERDICT=$(node -e 'console.log(require("./'"$FULL"'/results.json").metrics.verdict)')
echo "169-case verdict with stability $BEST + lead silence: $VERDICT"

step "4. deploy"
MODE=echo; [ "$VERDICT" = PASS ] && MODE=free
MODEL=$(cat .dev/aws/bedrock-model 2>/dev/null || true); SUM=$([ -n "$MODEL" ] && echo bedrock || echo template)
echo "→ READING_MODE=$MODE TRANSCRIBE_STABILITY=$BEST SUMMARY=$SUM ${MODEL}"
if [ $DEPLOY = 1 ] && { [ "$MODE" != echo ] || [ "$BEST" != high ] || [ "$SUM" != template ]; }; then
  READING_MODE=$MODE TRANSCRIBE_STABILITY=$BEST SUMMARY=$SUM BEDROCK_MODEL_ID="$MODEL" bash infra/aws/deploy.sh || fail "deploy failed"
else echo "no change to the running server (or --no-deploy)"; fi

step "DONE"
node tools/aws/cost-report.ts
echo "Phase A2 complete. Log: $LOG"
echo "Tell Claude: \"phase A2 done\""
