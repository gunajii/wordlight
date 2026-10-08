#!/usr/bin/env bash
# Deploy (or update) the WordLight dev server on AWS. Uses YOUR CLI credentials (aws login / aws configure).
#   bash infra/aws/deploy.sh            # create or update the stack, upload code + built story media, restart
#   bash infra/aws/deploy.sh --stop     # stop the instance (no compute charges; the Elastic IP is still billed)
#   bash infra/aws/deploy.sh --delete   # remove everything
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
REGION="${AWS_REGION:-ap-south-1}"; STACK=wordlight-dev
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="wordlight-dev-artifacts-$ACCOUNT-$REGION"
case "${1:-}" in
  --stop) ID=$(aws cloudformation describe-stacks --region "$REGION" --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text); aws ec2 stop-instances --region "$REGION" --instance-ids "$ID" >/dev/null; echo "stopped $ID"; exit 0;;
  --delete) read -r -p "Delete stack $STACK and bucket $BUCKET? [y/N] " a; [ "$a" = y ] || exit 1; aws cloudformation delete-stack --region "$REGION" --stack-name $STACK; aws s3 rb "s3://$BUCKET" --force --region "$REGION" || true; echo "deleting"; exit 0;;
esac
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
# code (tracked files) + built story media (not in git) — never recordings, .dev, bench
TMP=$(mktemp -d)
git archive --format=tar HEAD -o "$TMP/app.tar"
tar -rf "$TMP/app.tar" $(find content/stories -type f \( -name '*.mp3' -o -name '*.m4a' -o -name '*.jpg' -o -name '*.png' -o -name 'story.json' \) ! -path '*/s1-timing/*')
# runtime settings travel with the code (the unit reads them as EnvironmentFile, overriding the stack defaults),
# so changing the reading mode or the coach model is just another deploy
mkdir -p .dev/aws; [ -s .dev/aws/admin-token ] || (umask 077; openssl rand -hex 16 > .dev/aws/admin-token)   # operator endpoints; never committed
printf 'READING_MODE=%s\nSUMMARY=%s\nBEDROCK_MODEL_ID=%s\nADMIN_TOKEN=%s\n' "${READING_MODE:-free}" "${SUMMARY:-template}" "${BEDROCK_MODEL_ID:-}" "$(cat .dev/aws/admin-token)" > "$TMP/.deploy.env"
tar -rf "$TMP/app.tar" -C "$TMP" .deploy.env
gzip -9 "$TMP/app.tar" && aws s3 cp "$TMP/app.tar.gz" "s3://$BUCKET/wordlight/app.tgz" --region "$REGION" >/dev/null && rm -rf "$TMP"
echo "uploaded code to s3://$BUCKET/wordlight/app.tgz"
if aws cloudformation describe-stacks --region "$REGION" --stack-name $STACK >/dev/null 2>&1; then
  ID=$(aws cloudformation describe-stacks --region "$REGION" --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
  aws ec2 start-instances --region "$REGION" --instance-ids "$ID" >/dev/null; aws ec2 wait instance-running --region "$REGION" --instance-ids "$ID"
  CMD=$(aws ssm send-command --region "$REGION" --instance-ids "$ID" --document-name AWS-RunShellScript --parameters 'commands=["/usr/local/bin/wordlight-update"]' --query Command.CommandId --output text)
  echo "update sent ($CMD); waiting…"; aws ssm wait command-executed --region "$REGION" --command-id "$CMD" --instance-id "$ID" || true
else
  aws cloudformation deploy --region "$REGION" --stack-name $STACK --template-file infra/aws/wordlight-dev.yaml --capabilities CAPABILITY_IAM --parameter-overrides ArtifactBucket="$BUCKET" ReadingMode="${READING_MODE:-free}" Summary="${SUMMARY:-template}" BedrockModelId="${BEDROCK_MODEL_ID:-}"
fi
IP=$(aws cloudformation describe-stacks --region "$REGION" --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='PublicIp'].OutputValue" --output text)
URL="https://$(echo "$IP" | tr . -).sslip.io"
echo "WordLight server: $URL   (first boot: allow ~3 min for Node, Caddy and the certificate)"
for i in $(seq 40); do curl -sf "$URL/healthz" >/dev/null && { echo "healthy: $URL/healthz"; break; }; sleep 10; done
node tools/ops/healthcheck.ts "$URL" || echo "health check reported problems (see above)"
echo "TV: SERVER_URL=$URL MEDIA_URL=$URL bash apps/vega-tv/setup.sh   (then: bash tools/vvd/run-tv.sh)"
echo "When you stop testing:  bash infra/aws/deploy.sh --stop   ·   to remove everything:  bash infra/aws/deploy.sh --delete"
