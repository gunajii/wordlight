#!/usr/bin/env bash
# The project's spending policy as an AWS Budget: at most USD 100 of the USD 150 credits, ever.
# Budget "wordlight-credits": COST, counted BEFORE credits (gross usage), one period from 2026-10-01 to 2026-12-31,
# e-mail alerts at USD 60 / 80 / 90 / 95 actual and a forecast alert at USD 100. Replaces the earlier USD 5
# development budget ("wordlight-dev"), whose alerts would otherwise fire on every planned test.
#   bash tools/aws/budget-policy.sh            (idempotent; reads the alert e-mail from the existing budget)
set -euo pipefail
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
EMAIL=$(aws budgets describe-subscribers-for-notification --account-id "$ACCOUNT" --budget-name wordlight-dev \
  --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=80,ThresholdType=PERCENTAGE \
  --query 'Subscribers[0].Address' --output text 2>/dev/null || true)
[ -n "${EMAIL:-}" ] && [ "$EMAIL" != None ] || EMAIL=$(aws budgets describe-subscribers-for-notification --account-id "$ACCOUNT" --budget-name wordlight-credits \
  --notification NotificationType=ACTUAL,ComparisonOperator=GREATER_THAN,Threshold=60,ThresholdType=ABSOLUTE_VALUE --query 'Subscribers[0].Address' --output text 2>/dev/null || true)
[ -n "${EMAIL:-}" ] && [ "$EMAIL" != None ] || { echo "no alert e-mail found; run: EMAIL=you@example.com bash $0"; EMAIL="${EMAIL_OVERRIDE:-}"; [ -n "$EMAIL" ] || exit 1; }
if ! aws budgets describe-budget --account-id "$ACCOUNT" --budget-name wordlight-credits >/dev/null 2>&1; then
  aws budgets create-budget --account-id "$ACCOUNT" --budget '{
    "BudgetName":"wordlight-credits","BudgetType":"COST","TimeUnit":"ANNUALLY",
    "BudgetLimit":{"Amount":"100","Unit":"USD"},
    "TimePeriod":{"Start":"2026-10-01T00:00:00Z","End":"2026-12-31T23:59:59Z"},
    "CostTypes":{"IncludeCredit":false,"IncludeRefund":false}}' \
    --notifications-with-subscribers "$(python3 - "$EMAIL" <<'PY'
import json,sys
e=sys.argv[1]; sub=[{"SubscriptionType":"EMAIL","Address":e}]
n=[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":t,"ThresholdType":"ABSOLUTE_VALUE"},"Subscribers":sub} for t in (60,80,90,95)]
n.append({"Notification":{"NotificationType":"FORECASTED","ComparisonOperator":"GREATER_THAN","Threshold":100,"ThresholdType":"ABSOLUTE_VALUE"},"Subscribers":sub})
print(json.dumps(n))
PY
)"
  echo "created budget wordlight-credits (USD 100, gross; alerts 60/80/90/95 actual, 100 forecast) → $EMAIL"
else echo "budget wordlight-credits exists"; fi
aws budgets delete-budget --account-id "$ACCOUNT" --budget-name wordlight-dev >/dev/null 2>&1 && echo "removed the old USD 5 dev budget (replaced by wordlight-credits)" || true
