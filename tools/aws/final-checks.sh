#!/usr/bin/env bash
# Pre-submission checks that need AWS (read-only, ~free):
#   cd ~/Projects/wordlight && bash tools/aws/final-checks.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER=""
OUT="docs/results/final-checks-$(date -u +%Y%m%dT%H%M%SZ).md"; mkdir -p docs/results
{
echo "# Final AWS checks — $(date -u +%FT%TZ)"
echo; echo "## Identity (should NOT be root)"; aws sts get-caller-identity --query Arn --output text | sed -E 's/[0-9]{12}/<account>/'
echo; echo "## AI services opt-out (effective policy)"
aws organizations describe-effective-policy --policy-type AISERVICES_OPT_OUT_POLICY --query 'EffectivePolicy.PolicyContent' --output text 2>&1 | head -c 600; echo
echo; echo "## Server instance"
ID=$(aws cloudformation describe-stacks --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].[InstanceType,State.Name]' --output text
echo; echo "## DynamoDB progress records (counts only)"
aws dynamodb scan --table-name wordlight-progress --select COUNT --query '[Count,ScannedCount]' --output text 2>&1
aws dynamodb scan --table-name wordlight-progress --max-items 1 --output json 2>&1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const it=j.Items?.[0];console.log("attribute names of one record:",it?Object.keys(it).sort().join(", "):"(none)")}catch{console.log(s.slice(0,300))}})'
echo; echo "## Spend (gross, before credits; Cost Explorer may lag ~24 h)"
aws ce get-cost-and-usage --time-period Start=2026-10-01,End=$(date -u -v+1d +%Y-%m-%d 2>/dev/null || date -u -d tomorrow +%Y-%m-%d) --granularity MONTHLY --metrics UnblendedCost \
  --filter '{"Not":{"Dimensions":{"Key":"RECORD_TYPE","Values":["Credit","Refund"]}}}' --group-by Type=DIMENSION,Key=SERVICE --region us-east-1 --output json 2>&1 \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);let t=0;for(const r of j.ResultsByTime)for(const g of r.Groups){const a=+g.Metrics.UnblendedCost.Amount;t+=a;if(a>=0.005)console.log("  ",g.Keys[0].padEnd(40),"USD",a.toFixed(2))}console.log("  TOTAL gross USD",t.toFixed(2),"(ceiling 100, reserve 50)")}catch{console.log(s.slice(0,400))}})'
node tools/aws/cost-report.ts | head -1
echo; echo "## Budget"
aws budgets describe-budgets --account-id "$(aws sts get-caller-identity --query Account --output text)" --query 'Budgets[].[BudgetName,BudgetLimit.Amount,CalculatedSpend.ActualSpend.Amount]' --output text 2>&1
} | tee "$OUT"
echo "saved $OUT"
