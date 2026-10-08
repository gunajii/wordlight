#!/usr/bin/env bash
# PHASE A3: does Transcribe stability "none" hold up on all 169 S2 cases? About 15 min, about USD 0.35 (INFERRED).
#   cd ~/Projects/wordlight && bash tools/aws/phase-a3.sh          [--no-deploy]
# Decision rule, written before the run (commit history shows it):
#   "none" replaces "high" on the server only if, on all 169 cases with 600 ms of lead silence, it lights MORE
#   words within 1 s of the word start AND accepts NO MORE misread words than "high" in either language.
#   The S2 verdict rule doesn't change: READING_MODE stays echo unless a full run PASSES.
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER="" USAGE_FILE="$PWD/.dev/usage.json"
DEPLOY=1; for a in "$@"; do [ "$a" = --no-deploy ] && DEPLOY=0; done
STAMP=$(date -u +%Y%m%dT%H%M%SZ); LOG=".dev/aws/phase-a3-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
fail() { echo; echo "PHASE A3 STOPPED: $*"; echo "log: $LOG"; exit 1; }
aws sts get-caller-identity --query Account --output text >/dev/null || fail "no AWS credentials in this terminal (aws login)"
HIGH=$(ls -d docs/results/s2/polly-transcribe-*-full-high-lead600 | sort | tail -1); [ -n "$HIGH" ] || fail "no full high run"
echo "== S2, 169 cases, stability none, 600 ms lead silence"
node tools/s2/eval.ts --engine polly-transcribe --stability none --lead-silence-ms 600 --tag full-none-lead600 | tail -3 || fail "S2 run failed"
NONE=$(ls -d docs/results/s2/polly-transcribe-*-full-none-lead600 | sort | tail -1)
node tools/s2/compare.ts "$HIGH" "$NONE" | head -6
DECISION=$(node -e '
const h=require("./'"$HIGH"'/results.json").metrics, n=require("./'"$NONE"'/results.json").metrics;
const more=n.all.recallWithin1sPct>h.all.recallWithin1sPct;
const noMoreFA=["en-IN","hi-IN"].every(l=>n[l].misreadAccepted<=h[l].misreadAccepted);
console.log(`none: ${n.all.recallWithin1sPct}% vs high ${h.all.recallWithin1sPct}% within 1 s; misreads accepted en ${n["en-IN"].misreadAccepted} vs ${h["en-IN"].misreadAccepted}, hi ${n["hi-IN"].misreadAccepted} vs ${h["hi-IN"].misreadAccepted}`);
console.log(more&&noMoreFA?"none":"high");
console.log(n.verdict);')
echo "$DECISION" | head -1
STAB=$(echo "$DECISION" | sed -n 2p); VERDICT=$(echo "$DECISION" | sed -n 3p)
MODE=echo; [ "$VERDICT" = PASS ] && MODE=free
echo "decision: TRANSCRIBE_STABILITY=$STAB · S2 verdict (none) $VERDICT → READING_MODE=$MODE"
if [ $DEPLOY = 1 ]; then
  # always redeploy: the running server predates the TRANSCRIBE_STABILITY setting and the latest fixes
  READING_MODE=$MODE TRANSCRIBE_STABILITY=$STAB SUMMARY=template bash infra/aws/deploy.sh || fail "deploy failed"
fi
node tools/aws/cost-report.ts
echo "Phase A3 complete. Log: $LOG — tell Claude \"phase A3 done\""
