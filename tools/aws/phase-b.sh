#!/usr/bin/env bash
# PHASE B — the REAL loop: Vega TV + real phone + AWS server + Amazon Transcribe. No simulation, no dev tunnel.
#   cd ~/Projects/wordlight && bash tools/aws/phase-b.sh
# 1. finds the deployed server and checks it (TLS, real speech, no tunnel, WSS)
# 2. builds the TV app pointed at AWS and launches it on the Vega Virtual Device
# 3. you run one reading session with the phone (ADULT reader; steps printed below)
# 4. after you press Enter: end-to-end word-lit latency, privacy audit, reading results → docs/results/
set -uo pipefail
cd "$(dirname "$0")/../.."
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER=""
mkdir -p .dev/aws docs/results/e2e docs/results/privacy
STAMP=$(date -u +%Y%m%dT%H%M%SZ); LOG=".dev/aws/phase-b-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1
IP=$(aws cloudformation describe-stacks --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='PublicIp'].OutputValue" --output text) || { echo "no stack — run phase A first"; exit 1; }
URL="https://$(echo "$IP" | tr . -).sslip.io"
export ADMIN_TOKEN="$(cat .dev/aws/admin-token)"
ID=$(aws cloudformation describe-stacks --stack-name wordlight-dev --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
STATE=$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].State.Name' --output text)
if [ "$STATE" != running ]; then echo "starting the server instance ($STATE)…"; aws ec2 start-instances --instance-ids "$ID" >/dev/null; aws ec2 wait instance-running --instance-ids "$ID"; sleep 45; fi
echo "== server $URL"; node tools/ops/healthcheck.ts "$URL" || { echo "health check failed — tell Claude"; exit 1; }
curl -s "$URL/api/config"; echo
echo; echo "== TV app → AWS"
SERVER_URL="$URL" bash tools/vvd/run-tv.sh &
TVPID=$!
cat <<'TXT'

======================= YOUR PART (≈ 5 minutes, adult reader) =======================
When the TV home screen shows the QR code:
 1. Phone: scan the QR. The address bar must show  …sslip.io  (the AWS server) — NOT trycloudflare.
 2. Consent → name "Riya" → age 7 → English → Start reading session. (Mic must say "Microphone off".)
 3. TV: wait 10 s on the shelf (privacy check: mic stays off), then OK on the English story.
 4. During narration: mic must stay OFF on the phone.
 The server runs ECHO MODE (S2 decision): on each turn the TV reads the line first, then it's the reader's turn.
 5. First "Riya, your turn": after the TV reads the line, read it back at a natural pace.
 6. Second turn: read the first word, then STAY SILENT ~4 s (TV helps), then finish the line.
 7. If there is a third turn: say one WRONG word on purpose, then correct it.
 8. Optional privacy checks during a turn: press → on the TV (cancel), or lock the phone for 5 s.
 9. Let the story finish → end card. Check the phone shows the summary and "Microphone off".
=======================================================================================
TXT
read -r -p "Press Enter here when the end card is showing… " _
SID=$(curl -s -H "x-wordlight-admin: $ADMIN_TOKEN" "$URL/api/sessions" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s).filter(x=>x.tvConnected);console.log(l[0]?.sessionId??"")})')
[ -n "$SID" ] || { echo "no TV session found"; exit 1; }
echo "== session $SID"
node tools/e2e/word-lit-latency.ts "$URL" "$SID" --out "docs/results/e2e/real-$STAMP.json" || echo "(latency tool failed)"
curl -s -H "x-wordlight-admin: $ADMIN_TOKEN" "$URL/api/sessions/$SID/privacy" > "docs/results/privacy/aws-$STAMP.json"
curl -s -H "x-wordlight-admin: $ADMIN_TOKEN" "$URL/api/reading/traces?session=$SID" > ".dev/aws/traces-$STAMP.json"
curl -s -H "x-wordlight-admin: $ADMIN_TOKEN" "$URL/api/usage" > ".dev/aws/usage-server-$STAMP.json"
node -e 'const p=require("./docs/results/privacy/aws-'"$STAMP"'.json");console.log("privacy: status reports",p.micAudit.statusReports,"· violations",p.micAudit.violations.length,"· mic off after turn end (ms)",JSON.stringify(p.micAudit.offAfterEndMs))'
node -e 'const t=require("./.dev/aws/traces-'"$STAMP"'.json");for(const x of t)console.log(x.turnId,x.source,x.simulated?"SIMULATED":"real",x.endReason??"",JSON.stringify(x.result),"events",x.events.map(e=>e.kind[0]+e.index).join(" "))'
echo; echo "Phase B done. Log: $LOG — tell Claude \"phase B done\". (The server stops itself after 90 min idle; or: bash infra/aws/deploy.sh --stop)"
wait $TVPID 2>/dev/null
