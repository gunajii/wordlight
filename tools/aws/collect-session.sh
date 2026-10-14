#!/usr/bin/env bash
# Collect the measured results of a reading session that just ran on the AWS server (counts and timings only):
# end-to-end word-lit latency, the microphone audit, and the reading traces. The same steps as the end of phase-b.sh,
# for sessions run with tools/vvd/video-shoot.sh. Run it before the server's 90-minute idle stop.
#   cd ~/Projects/wordlight && bash tools/aws/collect-session.sh [SESSION_CODE] [label]
# Without a code it takes the newest session that had a reader. Output: docs/results/{e2e,privacy}/ + .dev/aws/.
set -uo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .dev/aws docs/results/e2e docs/results/privacy
STAMP=$(date -u +%Y%m%dT%H%M%SZ); LABEL=${2:-real}; LOG=".dev/aws/collect-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
IP=$(aws cloudformation describe-stacks --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='PublicIp'].OutputValue" --output text) || { echo "no stack"; exit 1; }
URL="https://$(echo "$IP" | tr . -).sslip.io"
export ADMIN_TOKEN="$(cat .dev/aws/admin-token)"
SID=${1:-}
if [ -z "$SID" ]; then
  SID=$(curl -s -H "x-wordlight-admin: $ADMIN_TOKEN" "$URL/api/sessions" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.error("sessions:",a.map(x=>x.sessionId+"("+x.readers+" readers"+(x.tvConnected?", tv":"")+")").join(" "));const r=a.find(x=>x.readers>0)??a[0];console.log(r?.sessionId??"")})')
fi
[ -n "$SID" ] || { echo "no session found"; exit 1; }
echo "== session $SID on $URL"
node tools/e2e/word-lit-latency.ts "$URL" "$SID" --out "docs/results/e2e/$LABEL-$STAMP.json" || echo "(latency tool failed)"
curl -s -H "x-wordlight-admin: $ADMIN_TOKEN" "$URL/api/sessions/$SID/privacy" > "docs/results/privacy/aws-$STAMP.json"
curl -s -H "x-wordlight-admin: $ADMIN_TOKEN" "$URL/api/reading/traces?session=$SID" > ".dev/aws/traces-$STAMP.json"
curl -s -H "x-wordlight-admin: $ADMIN_TOKEN" "$URL/api/usage" > ".dev/aws/usage-server-$STAMP.json"
node -e 'const p=require("./docs/results/privacy/aws-'"$STAMP"'.json");console.log("privacy: status reports",p.micAudit.statusReports,"· violations",p.micAudit.violations.length,"· mic off after turn end (ms)",JSON.stringify(p.micAudit.offAfterEndMs))'
node -e 'const t=require("./.dev/aws/traces-'"$STAMP"'.json");for(const x of t){console.log(x.turnId,x.source,x.simulated?"SIMULATED":"real",x.endReason??"",JSON.stringify(x.result))}'
echo "done → docs/results/e2e/$LABEL-$STAMP.json · tell Claude \"collected\""
