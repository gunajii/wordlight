#!/usr/bin/env bash
# Why did a parent's summary stay in English? Prints (1) what Amazon Translate returns for the masked summary
# (plain placeholder vs. a do-not-translate tag), and (2) the server's own [translate] log lines (via SSM).
#   cd ~/Projects/wordlight && bash tools/aws/translate-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
REGION="${AWS_REGION:-ap-south-1}"; export AWS_PAGER=""
T='XQZ read 28 words independently and needed help with 1 word, and finished “Clean Cat” (4 reading turns, 1 minute).'
H='<span translate="no">XQZ</span> read 28 words independently and needed help with 1 word, and finished “Clean Cat” (4 reading turns, 1 minute).'
# W21: a Devanagari book title inside the English sentence, plain vs. protected (what the server sends since 41c02d6)
M='<span translate="no">XQZ</span> read 14 words independently and needed help with 2 words, and finished “कामसू मुंग्या” (5 reading turns, 1 minute).'
M2='<span translate="no">XQZ</span> read 14 words independently and needed help with 2 words, and finished “<span translate="no">कामसू मुंग्या</span>” (5 reading turns, 1 minute).'
echo "== mr, title unprotected:"; aws translate translate-text --region "$REGION" --source-language-code en --target-language-code mr --text "$M" --query TranslatedText --output text 2>&1
echo "== mr, title protected (expect कामसू मुंग्या unchanged):"; aws translate translate-text --region "$REGION" --source-language-code en --target-language-code mr --text "$M2" --query TranslatedText --output text 2>&1
for L in mr hi; do
  echo "== $L, plain placeholder:"; aws translate translate-text --region "$REGION" --source-language-code en --target-language-code $L --text "$T" --query TranslatedText --output text 2>&1
  echo "== $L, do-not-translate tag:"; aws translate translate-text --region "$REGION" --source-language-code en --target-language-code $L --text "$H" --query TranslatedText --output text 2>&1
done
ID=$(aws cloudformation describe-stacks --region "$REGION" --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
ROLE=$(aws cloudformation describe-stack-resource --region "$REGION" --stack-name wordlight-dev --logical-resource-id Role --query StackResourceDetail.PhysicalResourceId --output text)
echo "== role $ROLE inline policies: $(aws iam list-role-policies --role-name "$ROLE" --query PolicyNames --output text 2>&1)"
echo "== server log ([translate] and summary lines, last 2 days):"
CMD=$(aws ssm send-command --region "$REGION" --instance-ids "$ID" --document-name AWS-RunShellScript \
  --parameters 'commands=["journalctl -u wordlight --since -2d --no-pager | grep -E \"\\[translate\\]|session-summary|TRANSLATE\" | tail -20; grep -c TRANSLATE /opt/wordlight/app/.deploy.env; ls /opt/wordlight/app/node_modules/@aws-sdk | grep -c client-translate"]' \
  --query Command.CommandId --output text) && sleep 6 && \
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$ID" --query '[StandardOutputContent,StandardErrorContent]' --output text
