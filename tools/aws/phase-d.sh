#!/usr/bin/env bash
# PHASE D — help timing on the real recogniser + deploy + certificate reuse check. ~12 min; ≈ USD 0.25 (INFERRED).
#   cd ~/Projects/wordlight && bash tools/aws/phase-d.sh
# 1. help-recovery: 10 turn lines from the shipped stories × 2 reading paces × before/after the fix, adult synthetic
#    voice through Amazon Transcribe (tools/s2/help-recovery.ts) → docs/results/help/
# 2. deploy the fixed server (runtime settings kept: echo mode, stability high, template summary)
# 3. certificate reuse: the certificate serial before and after the deploy must be the same → docs/results/deploy/
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER="" USAGE_FILE="$PWD/.dev/usage.json"
STAMP=$(date -u +%Y%m%dT%H%M%SZ); LOG=".dev/aws/phase-d-$STAMP.log"; mkdir -p .dev/aws docs/results/deploy
exec > >(tee -a "$LOG") 2>&1
fail() { echo; echo "PHASE D STOPPED: $*"; echo "log: $LOG — tell Claude \"phase D stopped\""; exit 1; }
aws sts get-caller-identity --query Account --output text >/dev/null || fail "no AWS credentials in this terminal (aws login)"
node tools/aws/cost-report.ts
if ls -d docs/results/help/recovery-* >/dev/null 2>&1 && [ "${1:-}" != --remeasure ]; then
  echo "== 1. help recovery: already measured ($(ls -d docs/results/help/recovery-* | tail -1)) — pass --remeasure to run again"
else
  echo "== 1. help recovery on the real recogniser (~8 min)"
  node tools/s2/help-recovery.ts || fail "help-recovery failed"
fi
echo "== 2. deploy"
IP=$(aws cloudformation describe-stacks --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='PublicIp'].OutputValue" --output text)
HOST="$(echo "$IP" | tr . -).sslip.io"
cert() { echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -serial -startdate 2>/dev/null; }
ID=$(aws cloudformation describe-stacks --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
STATE=$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].State.Name' --output text)
echo "instance state before: $STATE"
if [ "$STATE" != running ]; then bash tools/aws/start-server.sh || fail "could not start the server instance"; sleep 60; fi
BEFORE=$(cert); echo "certificate before: $BEFORE"
bash infra/aws/deploy.sh || fail "deploy failed"
sleep 5; AFTER=$(cert); echo "certificate after:  $AFTER"
SAME=no; [ -n "$BEFORE" ] && [ "$BEFORE" = "$AFTER" ] && SAME=yes
printf 'date: %s\nhost: %s\ninstance state before deploy: %s\nbefore: %s\nafter:  %s\nsame certificate (no new issuance): %s\n' "$(date -u +%FT%TZ)" "$HOST" "$STATE" "$BEFORE" "$AFTER" "$SAME" > "docs/results/deploy/cert-reuse-$STAMP.txt"
echo "same certificate after deploy: $SAME"
node tools/aws/cost-report.ts
echo; echo "Phase D complete. Log: $LOG"
echo "Next: bash tools/aws/phase-b.sh (new TV build reports when the help word ends) — then tell Claude \"phase D done\""
