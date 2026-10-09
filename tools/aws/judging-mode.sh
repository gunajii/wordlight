#!/usr/bin/env bash
# Keep the WordLight server available for the official judging period (2026-11-09 → 11-20), then go back to the
# cost-saving idle stop.
#   bash tools/aws/judging-mode.sh on     start the instance, turn OFF the 90-min idle auto-stop, health check
#   bash tools/aws/judging-mode.sh off    turn the idle auto-stop back ON (the instance stops after 90 idle minutes)
#   bash tools/aws/judging-mode.sh status
# Cost (INFERRED from list prices): t4g.small + Elastic IP ≈ USD 0.022/h → ≈ USD 0.53/day → ≈ USD 6.3 for 12 days.
# The server's own daily caps (Transcribe 60 min, Polly 150k chars) and the USD 100 budget alerts stay in force.
set -uo pipefail
cd "$(dirname "$0")/../.."
REGION="${AWS_REGION:-ap-south-1}"; export AWS_PAGER=""
ID=$(aws cloudformation describe-stacks --region "$REGION" --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text) || exit 1
run() { local c; c=$(aws ssm send-command --region "$REGION" --instance-ids "$ID" --document-name AWS-RunShellScript --parameters "commands=[\"$1\"]" --query Command.CommandId --output text) || return 1
  aws ssm wait command-executed --region "$REGION" --command-id "$c" --instance-id "$ID" 2>/dev/null
  aws ssm get-command-invocation --region "$REGION" --command-id "$c" --instance-id "$ID" --query StandardOutputContent --output text; }
case "${1:-status}" in
  on)  bash tools/aws/start-server.sh || exit 1; sleep 30
       run "systemctl disable --now wordlight-idle.timer; systemctl is-active wordlight-idle.timer || true"
       IP=$(aws cloudformation describe-stacks --region "$REGION" --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='PublicIp'].OutputValue" --output text)
       node tools/ops/healthcheck.ts "https://$(echo "$IP" | tr . -).sslip.io"
       echo "judging mode ON: the server stays up until 'judging-mode.sh off' (≈ USD 0.53/day, INFERRED)";;
  off) run "systemctl enable --now wordlight-idle.timer; systemctl is-active wordlight-idle.timer"; echo "idle auto-stop back ON";;
  *)   aws ec2 describe-instances --region "$REGION" --instance-ids "$ID" --query 'Reservations[0].Instances[0].[State.Name,InstanceType]' --output text
       run "systemctl is-active wordlight-idle.timer || true";;
esac
