#!/usr/bin/env bash
# Start the WordLight server instance predictably (used by deploy.sh, phase scripts and the demo):
#   bash tools/aws/start-server.sh            → prints the state; exits 0 once the instance is running
# EC2 can refuse a start with InsufficientInstanceCapacity (seen 2026-10-09 for t4g.micro in ap-south-1). Then:
# retry 3× one minute apart; if it still fails, switch the stopped instance to the next Graviton size (t4g.small,
# ≈ USD 0.01/h more — INFERRED from list prices) and start that. The change is printed and logged; switch back with
#   aws ec2 modify-instance-attribute --instance-id <id> --instance-type t4g.micro   (while stopped)
set -uo pipefail
REGION="${AWS_REGION:-ap-south-1}"; export AWS_PAGER=""
ID=$(aws cloudformation describe-stacks --region "$REGION" --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text) || exit 1
state() { aws ec2 describe-instances --region "$REGION" --instance-ids "$ID" --query 'Reservations[0].Instances[0].[State.Name,InstanceType]' --output text; }
read -r ST TYPE <<<"$(state)"; echo "instance $ID: $ST ($TYPE)"
[ "$ST" = running ] && exit 0
[ "$ST" = stopping ] && { aws ec2 wait instance-stopped --region "$REGION" --instance-ids "$ID"; }
try() { aws ec2 start-instances --region "$REGION" --instance-ids "$ID" >/dev/null 2>/tmp/wl-start.err && return 0; cat /tmp/wl-start.err; return 1; }
for n in 1 2 3; do
  if try; then aws ec2 wait instance-running --region "$REGION" --instance-ids "$ID" && { echo "running ($TYPE)"; exit 0; }; fi
  grep -q InsufficientInstanceCapacity /tmp/wl-start.err || exit 1
  echo "no $TYPE capacity right now (attempt $n/3) — waiting 60 s"; sleep 60
done
NEXT=t4g.small; [ "$TYPE" = t4g.small ] && NEXT=t4g.medium
echo "switching the stopped instance $TYPE → $NEXT (same Graviton image) and starting it"
aws ec2 modify-instance-attribute --region "$REGION" --instance-id "$ID" --instance-type "{\"Value\":\"$NEXT\"}" || exit 1
mkdir -p .dev/aws; echo "$(date -u +%FT%TZ) $ID $TYPE -> $NEXT (InsufficientInstanceCapacity)" >> .dev/aws/instance-type-changes.log
try && aws ec2 wait instance-running --region "$REGION" --instance-ids "$ID" && { echo "running ($NEXT)"; exit 0; }
exit 1
