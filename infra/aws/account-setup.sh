#!/usr/bin/env bash
# WordLight AWS account setup (run on the Mac, with YOUR credentials already configured in ~/.aws — never paste
# keys into chat or the repo). Every change is shown first and needs a "y".
#   bash infra/aws/account-setup.sh --email you@example.com [--region ap-south-1] [--budget 5]
# Does: 1) identity check  2) monthly cost budget with e-mail alerts at 80 % actual and 100 % forecast
#       3) AI services opt-out (Transcribe/Polly may otherwise store and use content to improve the service)
#          — needs AWS Organizations; if the account has none, creating one makes it the management account (free).
#       4) prints the least-privilege IAM policy for the developer identity (infra/aws/iam-dev-policy.json).
set -uo pipefail
EMAIL=""; REGION="ap-south-1"; BUDGET=5
while [ $# -gt 0 ]; do case "$1" in --email) EMAIL="$2"; shift 2;; --region) REGION="$2"; shift 2;; --budget) BUDGET="$2"; shift 2;; *) echo "unknown $1"; exit 2;; esac; done
command -v aws >/dev/null || { echo "AWS CLI missing: brew install awscli"; exit 1; }
ask() { read -r -p "$1 [y/N] " a; [ "$a" = "y" ] || [ "$a" = "Y" ]; }
ID=$(aws sts get-caller-identity --output json) || { echo "No working credentials: run 'aws configure' (or 'aws configure sso') first."; exit 1; }
ACCOUNT=$(echo "$ID" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Account"])')
echo "Account $ACCOUNT · identity $(echo "$ID" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Arn"])') · region $REGION"

echo; echo "== 1. Budget: USD $BUDGET / month, e-mail at 80 % actual and 100 % forecast"
if aws budgets describe-budget --account-id "$ACCOUNT" --budget-name wordlight-dev >/dev/null 2>&1; then echo "exists: wordlight-dev"
elif [ -z "$EMAIL" ]; then echo "skipped: pass --email to create it"
elif ask "Create budget wordlight-dev (USD $BUDGET) alerting $EMAIL?"; then
  aws budgets create-budget --account-id "$ACCOUNT" \
    --budget "{\"BudgetName\":\"wordlight-dev\",\"BudgetLimit\":{\"Amount\":\"$BUDGET\",\"Unit\":\"USD\"},\"TimeUnit\":\"MONTHLY\",\"BudgetType\":\"COST\"}" \
    --notifications-with-subscribers "[{\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":80,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$EMAIL\"}]},{\"Notification\":{\"NotificationType\":\"FORECASTED\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":100,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$EMAIL\"}]}]" \
    && echo "created"
fi

echo; echo "== 2. AI services opt-out (all AI services, incl. Transcribe and Polly)"
ORG=$(aws organizations describe-organization --output json 2>/dev/null)
if [ -z "$ORG" ]; then
  echo "This account is not in an AWS Organization. An opt-out policy needs one."
  if ask "Create an Organization with this account as its management account (no cost)?"; then aws organizations create-organization --feature-set ALL >/dev/null && echo "organization created"; ORG=$(aws organizations describe-organization --output json 2>/dev/null); fi
fi
if [ -n "$ORG" ]; then
  ROOT_ID=$(aws organizations list-roots --query 'Roots[0].Id' --output text)
  aws organizations enable-policy-type --root-id "$ROOT_ID" --policy-type AISERVICES_OPT_OUT_POLICY >/dev/null 2>&1 || true
  PID=$(aws organizations list-policies --filter AISERVICES_OPT_OUT_POLICY --query "Policies[?Name=='wordlight-ai-optout'].Id" --output text)
  if [ -z "$PID" ] || [ "$PID" = "None" ]; then
    if ask "Create and attach AI opt-out policy (all services) to the organization root?"; then
      PID=$(aws organizations create-policy --name wordlight-ai-optout --type AISERVICES_OPT_OUT_POLICY --description "Opt out of AI service content use" \
        --content '{"services":{"default":{"opt_out_policy":{"@@assign":"optOut"}}}}' --query 'Policy.PolicySummary.Id' --output text)
      aws organizations attach-policy --policy-id "$PID" --target-id "$ROOT_ID" && echo "attached $PID"
    fi
  else echo "exists: $PID"; fi
  aws organizations describe-effective-policy --policy-type AISERVICES_OPT_OUT_POLICY --target-id "$ACCOUNT" --query 'EffectivePolicy.PolicyContent' --output text 2>/dev/null && echo "(effective policy for this account)"
fi

echo; echo "== 3. Developer permissions needed (least privilege): infra/aws/iam-dev-policy.json"
cat "$(dirname "$0")/iam-dev-policy.json"
echo; echo "== 4. Quick service check in $REGION"
aws polly describe-voices --region "$REGION" --engine neural --language-code hi-IN --include-additional-language-codes --query 'Voices[].Id' --output text && echo "(neural hi-IN voices)"
echo "Done. Next: AWS_REGION=$REGION node tools/s4/polly-s4.ts"
