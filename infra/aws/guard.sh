#!/usr/bin/env bash
# Zero-spend guard + readiness check. Safe to re-run. Makes no paid API calls
# (no Cost Explorer: it charges per request).
#   bash infra/aws/guard.sh            # check only
#   bash infra/aws/guard.sh --tighten  # also: budget -> USD 5 (gross, credits NOT netted) + USD 1 early alert
set -u
REGION="${AWS_REGION:-ap-south-1}"; TIGHTEN=0; [ "${1:-}" = "--tighten" ] && TIGHTEN=1
ok(){ echo "  OK    $*"; }; bad(){ echo "  FAIL  $*"; }
ACCOUNT=$(aws sts get-caller-identity --query Account --output text) || { echo "No credentials: run 'aws login' in this terminal first."; exit 1; }
ARN=$(aws sts get-caller-identity --query Arn --output text)
echo "Account $ACCOUNT  ($ARN)  region $REGION"
case "$ARN" in *:root) echo "  NOTE  signed in as root; switch to an IAM user once services work.";; esac

echo; echo "== Services"
V=$(aws polly describe-voices --region "$REGION" --engine neural --language-code hi-IN --query 'Voices[].Id' --output text 2>&1) \
  && ok "Polly neural hi-IN: $V" || bad "Polly: $(echo "$V" | tail -1)"
T=$(aws transcribe list-vocabularies --region "$REGION" --max-results 1 2>&1) \
  && ok "Transcribe reachable" || bad "Transcribe: $(echo "$T" | tail -1)"

echo; echo "== AI data opt-out (want: optOut)"
P=$(aws organizations describe-effective-policy --policy-type AISERVICES_OPT_OUT_POLICY --target-id "$ACCOUNT" --query EffectivePolicy.PolicyContent --output text 2>&1)
echo "$P" | grep -q optOut && ok "effective policy contains optOut" || bad "effective policy: $P"

echo; echo "== Things that cost money while running"
I=$(aws ec2 describe-instances --region "$REGION" --filters Name=instance-state-name,Values=running,pending --query 'Reservations[].Instances[].InstanceId' --output text 2>&1)
[ -z "$I" ] && ok "no running EC2 instances" || echo "  RUNNING  $I  (stop with: bash infra/aws/deploy.sh --stop)"
E=$(aws ec2 describe-addresses --region "$REGION" --query 'length(Addresses)' --output text 2>&1)
echo "  INFO  Elastic IPs: $E (each ~USD 0.005/h, charged even while the server is stopped; deploy.sh --delete removes it)"

echo; echo "== Budget"
if aws budgets describe-budget --account-id "$ACCOUNT" --budget-name wordlight-dev >/dev/null 2>&1; then
  aws budgets describe-budget --account-id "$ACCOUNT" --budget-name wordlight-dev \
    --query 'Budget.{limit:BudgetLimit.Amount,spent:CalculatedSpend.ActualSpend.Amount,netOfCredits:CostTypes.IncludeCredit}' --output text | sed 's/^/  /'
  if [ $TIGHTEN = 1 ]; then
    EMAIL=$(aws budgets describe-subscribers-for-notification --account-id "$ACCOUNT" --budget-name wordlight-dev \
      --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=80,ThresholdType=PERCENTAGE \
      --query 'Subscribers[0].Address' --output text 2>/dev/null)
    B=$(aws budgets describe-budget --account-id "$ACCOUNT" --budget-name wordlight-dev --query Budget --output json)
    B=$(echo "$B" | python3 -c 'import json,sys;b=json.load(sys.stdin);[b.pop(k,None) for k in ("CalculatedSpend","LastUpdatedTime","PlannedBudgetLimits")];b["BudgetLimit"]["Amount"]="5";b.setdefault("CostTypes",{})["IncludeCredit"]=False;print(json.dumps(b))')
    aws budgets update-budget --account-id "$ACCOUNT" --new-budget "$B" && ok "budget now USD 5/month, counted BEFORE credits"
    if [ -n "$EMAIL" ] && [ "$EMAIL" != "None" ]; then
      aws budgets create-notification --account-id "$ACCOUNT" --budget-name wordlight-dev \
        --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=1,ThresholdType=ABSOLUTE_VALUE \
        --subscribers SubscriptionType=EMAIL,Address="$EMAIL" 2>/dev/null && ok "early alert at USD 1 usage -> $EMAIL" || echo "  INFO  USD 1 alert already exists"
    else bad "could not read the alert e-mail; add a USD 1 alert in the Budgets console"; fi
  fi
else bad "budget wordlight-dev missing: run infra/aws/account-setup.sh --email you@example.com"; fi
echo; echo "Credits left: console -> Billing and Cost Management -> Credits (not readable here without a paid API call)."
