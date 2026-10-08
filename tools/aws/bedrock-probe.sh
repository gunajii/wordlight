#!/usr/bin/env bash
# One Bedrock call with the request ID kept, for the AWS Support case (docs/AWS_BEDROCK_SUPPORT.md). Cost: ~0.
#   cd ~/Projects/wordlight && bash tools/aws/bedrock-probe.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
REGION="${AWS_REGION:-ap-south-1}"; OUT=".dev/aws/bedrock-probe-$(date -u +%Y%m%dT%H%M%SZ).txt"
{
  echo "time (UTC): $(date -u +%FT%TZ) · region: $REGION"
  aws sts get-caller-identity --query 'Arn' --output text | sed -E 's/[0-9]{12}/<account>/'
  echo "--- GetFoundationModelAvailability amazon.nova-micro-v1:0"
  aws bedrock get-foundation-model-availability --region "$REGION" --model-id amazon.nova-micro-v1:0 --output json 2>&1
  echo "--- Converse apac.amazon.nova-micro-v1:0 (request id from the debug log)"
  aws bedrock-runtime converse --region "$REGION" --model-id apac.amazon.nova-micro-v1:0 --messages '[{"role":"user","content":[{"text":"Say OK."}]}]' --inference-config '{"maxTokens":5}' --debug 2>&1 \
    | grep -iE "x-amzn-requestid|An error occurred|\"text\"" | grep -viE "authorization|signature|credential|token" | head -5
} | tee "$OUT"
echo "saved: $OUT (no credentials in it) — paste the request id into the support case"
