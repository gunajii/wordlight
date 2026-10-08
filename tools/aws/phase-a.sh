#!/usr/bin/env bash
# PHASE A — everything that needs AWS but not the phone or TV. One command; ~30–40 min; ≈ USD 1–2 of credits
# (INFERRED: Polly ≈ 25k chars, Transcribe ≈ 25 min, Bedrock ≈ 60 short calls, EC2 from deploy onwards).
#   cd ~/Projects/wordlight && bash tools/aws/phase-a.sh            [--skip-s2] [--skip-deploy]
# Steps: account + region checks → spending policy budget → Bedrock model discovery → S4 (Polly timing) →
# S2 (Transcribe, 169 cases) → Bedrock coach benchmark → stories narrated by Polly → deploy (mode from S2) → health check.
# Stops at the first failing step. Everything is logged to .dev/aws/ and results go to docs/results/.
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER="" USAGE_FILE="$PWD/.dev/usage.json"
SKIP_S2=0; SKIP_DEPLOY=0
for a in "$@"; do case "$a" in --skip-s2) SKIP_S2=1;; --skip-deploy) SKIP_DEPLOY=1;; esac; done
mkdir -p .dev/aws
STAMP=$(date -u +%Y%m%dT%H%M%SZ); LOG=".dev/aws/phase-a-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
step() { echo; echo "=================== $* ==================="; }
fail() { echo; echo "PHASE A STOPPED: $*"; echo "log: $LOG — tell Claude \"phase A stopped\""; exit 1; }
ce_snapshot() { aws ce get-cost-and-usage --time-period Start=2026-10-01,End=$(date -u -v+1d +%Y-%m-%d 2>/dev/null || date -u -d tomorrow +%Y-%m-%d) \
  --granularity MONTHLY --metrics UnblendedCost --filter '{"Not":{"Dimensions":{"Key":"RECORD_TYPE","Values":["Credit","Refund"]}}}' \
  --region us-east-1 > ".dev/aws/ce-$1.json" 2>/dev/null && node tools/aws/cost-report.ts ".dev/aws/ce-$1.json" || echo "(Cost Explorer not available yet — normal for a new account)"; }

step "0. tools"
for t in aws node python3 git; do command -v $t >/dev/null || fail "$t not installed"; done
NUMPY=1; python3 -c "import numpy" 2>/dev/null || { NUMPY=0; echo "python3 numpy not installed: S4 audio is synthesized here and analysed by Claude afterwards"; }
git status --short | head -5

step "1. account and region"
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table || fail "no AWS credentials in this terminal (aws login)"
echo "region: $AWS_REGION"
bash infra/aws/guard.sh | tee .dev/aws/guard-$STAMP.txt
grep -q "FAIL  Polly" .dev/aws/guard-$STAMP.txt && fail "Polly not available on this account yet"
grep -q "FAIL  Transcribe" .dev/aws/guard-$STAMP.txt && fail "Transcribe not available on this account yet"

step "2. spending policy (USD 100 ceiling, alerts 60/80/90/95) + cost before"
bash tools/aws/budget-policy.sh || echo "(budget step failed — continuing; check the Budgets console)"
ce_snapshot "before-$STAMP"

step "3. Bedrock models available in $AWS_REGION"
aws bedrock list-foundation-models --region "$AWS_REGION" --by-output-modality TEXT --output json > .dev/aws/bedrock-models.json 2>/dev/null || echo "{}" > .dev/aws/bedrock-models.json
aws bedrock list-inference-profiles --region "$AWS_REGION" --output json > .dev/aws/bedrock-profiles.json 2>/dev/null || echo "{}" > .dev/aws/bedrock-profiles.json
node -e '
const m=require("./.dev/aws/bedrock-models.json").modelSummaries??[], p=require("./.dev/aws/bedrock-profiles.json").inferenceProfileSummaries??[];
const small=/nova-micro|nova-lite|haiku|llama3-2-(1|3)b|llama3-1-8b|llama3-8b|ministral|mistral-small|gemma/i;
const ids=[...m.filter(x=>(x.inferenceTypesSupported??[]).includes("ON_DEMAND")&&small.test(x.modelId)).map(x=>x.modelId),
           ...p.filter(x=>small.test(x.inferenceProfileId)).map(x=>x.inferenceProfileId)];
require("fs").writeFileSync(".dev/aws/bedrock-candidates.json",JSON.stringify([...new Set(ids)]));
console.log("text models listed:",m.length,"· inference profiles:",p.length,"· small candidates:",[...new Set(ids)].join(", ")||"NONE");'

step "4. S4 — Polly word timing (real)"
node tools/s4/polly-s4.ts || fail "S4 synthesis failed"
if [ $NUMPY = 1 ]; then python3 tools/s4/analyze.py content/build/s4 --report docs/results/s4 || fail "S4 analysis failed"; else echo "(S4 analysis deferred: no numpy on this Mac)"; fi

if [ $SKIP_S2 = 0 ]; then
  step "5. S2 — Transcribe in the reading loop (169 cases, real time, ~12–20 min)"
  node tools/s2/eval.ts --engine polly-transcribe || fail "S2 run failed"
fi

step "6. Bedrock parent coach — model benchmark (cheapest first)"
if [ "$(cat .dev/aws/bedrock-candidates.json)" != "[]" ]; then
  node tools/bedrock/bench.ts --candidates .dev/aws/bedrock-candidates.json --max 5 || echo "(Bedrock benchmark failed — the template summary stays)"
else echo "no small text models listed in $AWS_REGION — the template summary stays (documented)"; fi

step "7. stories with real Polly narration"
S4_V=$(ls -d docs/results/s4/2* 2>/dev/null | sort | tail -1); S4_V=$( [ -n "$S4_V" ] && node -e 'console.log(require("./'"$S4_V"'/results.json").verdict)' || echo UNKNOWN)
VER=""; [ "$S4_V" = PASS ] && VER="--verified"; echo "S4 verdict $S4_V → timings ${VER:-not} marked verified"
MODEL=$(cat .dev/aws/bedrock-model 2>/dev/null || true)
[ -f content/sources/wl-test-kite/p1.png ] || python3 tools/content/make-test-art.py
node tools/content/build-story.ts wl-test-kite $VER ${MODEL:+--turn-model "$MODEL"} || fail "story build (test story, Polly) failed"
for d in content/sources/*/; do id=$(basename "$d"); [ "$id" = wl-test-kite ] && continue
  [ -f "$d/source.json" ] && ! grep -q CHECK "$d/source.json" && { node tools/content/build-story.ts "$id" $VER ${MODEL:+--turn-model "$MODEL"} || echo "(story $id failed to build)"; }
done
node tools/content/validate-story.ts || fail "story validation failed"

step "8. usage so far"
node tools/aws/cost-report.ts

if [ $SKIP_DEPLOY = 0 ]; then
  step "9. deploy the WordLight server to AWS"
  LATEST_S2=$(ls -d docs/results/s2/polly-transcribe-* 2>/dev/null | sort | tail -1)
  VERDICT=$( [ -n "$LATEST_S2" ] && node -e 'console.log(require("./'"$LATEST_S2"'/results.json").metrics.verdict)' || echo UNKNOWN)
  MODE=free; [ "$VERDICT" = FAIL ] && MODE=echo
  MODEL=$(cat .dev/aws/bedrock-model 2>/dev/null || true)
  echo "S2 verdict: $VERDICT → READING_MODE=$MODE · Bedrock coach: ${MODEL:-template only}"
  READING_MODE=$MODE SUMMARY=$([ -n "$MODEL" ] && echo bedrock || echo template) BEDROCK_MODEL_ID="$MODEL" bash infra/aws/deploy.sh || fail "deploy failed"
fi

step "DONE"
ce_snapshot "after-$STAMP"
echo "Phase A complete. Log: $LOG"
echo "Tell Claude: \"phase A done\""
