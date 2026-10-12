#!/usr/bin/env bash
# Reading turns by age for the three stories: add each story's turn pool and the help clips its words need
# (Polly neural, ≈ 145 short words, well under USD 0.05). Narration, timings and default turns are not touched.
#   cd ~/Projects/wordlight && bash tools/content/age-turns.sh      then: bash infra/aws/deploy.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER="" USAGE_FILE="$PWD/.dev/usage.json"
mkdir -p .dev/aws; LOG=".dev/aws/age-turns-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee -a "$LOG") 2>&1
fail() { echo; echo "AGE-TURNS STOPPED: $*"; echo "log: $LOG — tell Claude \"age turns stopped\""; exit 1; }
aws sts get-caller-identity --query Account --output text >/dev/null || fail "no AWS credentials in this terminal (aws login)"
for id in busy-ants busy-ants-hi naughty-dog; do node tools/content/turn-pool.ts "$id" || fail "$id failed"; done
node tools/content/validate-story.ts || fail "validation failed"
echo; echo "Done, not deployed. Log: $LOG — tell Claude \"age turns built\""
