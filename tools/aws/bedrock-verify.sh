#!/usr/bin/env bash
# Verify Amazon Bedrock access for WordLight (docs/AWS_BEDROCK_SUPPORT.md). Run on the Mac, signed in with aws login.
#   cd ~/Projects/wordlight && bash tools/aws/bedrock-verify.sh
# Identity (account number masked), region, model listing, authorization status, budget, then ONE real Converse call
# with synthetic numbers (stops at the first success or account-level denial). Cost: well under USD 0.01.
# Output → .dev/aws/bedrock-verify-<UTC>.txt. No credentials are printed.
set -uo pipefail
cd "$(dirname "$0")/../.."
REGION="${AWS_REGION:-ap-south-1}"; OUT=".dev/aws/bedrock-verify-$(date -u +%Y%m%dT%H%M%SZ).txt"; mkdir -p .dev/aws
{
  echo "time (UTC) $(date -u +%FT%TZ)"
  echo "## identity"
  ARN=$(aws sts get-caller-identity --query Arn --output text 2>&1); echo "  ${ARN//[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]/<account>}"
  case "$ARN" in *:root) echo "  NOTE: signed in as the ROOT user (docs/SECURITY.md recommends an IAM user)";; esac
  echo "  configured region: $(aws configure get region 2>/dev/null || echo '(none)') · region used: $REGION"
  echo "## models (text, $REGION)"
  aws bedrock list-foundation-models --region "$REGION" --by-output-modality TEXT \
    --query 'modelSummaries[?contains(modelId,`nova-micro`)||contains(modelId,`nova-lite`)].[modelId,join(`,`,inferenceTypesSupported),modelLifecycle.status]' --output text 2>&1 | sed 's/^/  /'
  echo "## inference profiles (nova micro/lite)"
  aws bedrock list-inference-profiles --region "$REGION" \
    --query 'inferenceProfileSummaries[?contains(inferenceProfileId,`nova-micro`)||contains(inferenceProfileId,`nova-lite`)].[inferenceProfileId,status]' --output text 2>&1 | sed 's/^/  /'
  echo "## authorization (GetFoundationModelAvailability)"
  for m in amazon.nova-micro-v1:0 amazon.nova-lite-v1:0; do
    printf '  %s: ' "$m"; aws bedrock get-foundation-model-availability --region "$REGION" --model-id "$m" \
      --query '[regionAvailability,entitlementAvailability,agreementAvailability.status,authorizationStatus]' --output text 2>&1 | tr '\t' ' '
  done
  echo "## budget (before the call)"
  aws budgets describe-budgets --account-id "$(aws sts get-caller-identity --query Account --output text)" \
    --query 'Budgets[].[BudgetName,BudgetLimit.Amount,CalculatedSpend.ActualSpend.Amount]' --output text 2>&1 | sed 's/^/  /'
  echo "## real invocation (Converse, synthetic numbers)"
  AWS_REGION="$REGION" node tools/bedrock/verify.ts 2>&1 | sed 's/^/  /'
} | tee "$OUT"
echo "saved: $OUT — tell Claude \"bedrock verified\""
