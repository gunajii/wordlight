# AWS

## Status (2026-10-09)
- Deployed in ap-south-1 since 2026-10-08: CloudFormation stack `wordlight-dev` (EC2 Graviton — t4g.small since a
  capacity fallback on 2026-10-09 — Elastic IP, Caddy TLS on `3-110-13-229.sslip.io`, instance role, DynamoDB table,
  SSM). Echo Mode, Transcribe stability high, template summary.
- Cost guard now: budget `wordlight-credits` USD 100 gross (before credits) with alerts at 60/80/90/95 and a forecast
  alert at 100 (`tools/aws/budget-policy.sh`); the earlier USD 5/30 budget was removed. Server ≈ USD 0.015–0.025/h
  running; stop with `bash infra/aws/deploy.sh --stop`.
- Bedrock: blocked at account level (docs/AWS_BEDROCK_SUPPORT.md). Security steps: docs/SECURITY.md.
- The sections below are the original plan (2026-09-30/10-05), kept for the record.

# AWS — development path (2026-09-30)

## Region: ap-south-1 (Mumbai) — verified against current AWS docs
| Need | ap-south-1 | Source |
|---|---|---|
| Transcribe **streaming**, hi-IN and en-IN | yes — streaming endpoint `transcribestreaming.ap-south-1.amazonaws.com`; hi-IN and en-IN list "batch, streaming"; the regions excluded for these languages are af-south-1, ap-northeast-1, ap-southeast-5, ap-southeast-7, cn-northwest-1 (not Mumbai) | docs.aws.amazon.com/general/latest/gr/transcribe.html · transcribe/latest/dg/supported-languages.html |
| Polly **neural** + Kajal (hi-IN, en-IN) | neural voices are offered in ap-south-1; Kajal is neural for hi-IN and en-IN (en-IN also generative) | polly/latest/dg/neural-voices.html · available-voices.html |
| Bedrock | Nova Micro / Nova Lite listed and ACTIVE in ap-south-1 via the `apac.` inference profiles, but the account is NOT_AUTHORIZED (2026-10-08, re-checked 2026-10-09) | docs/AWS_BEDROCK_SUPPORT.md |

Runtime check, not assumed: `tools/s4/polly-s4.ts` calls `DescribeVoices` and stops if Kajal (neural) is not offered in the region.

## Privacy settings on the account
- AWS AI services **may store and use customer content to improve the service** unless the account opts out; Transcribe and Polly are both covered by the AI services opt-out policy (AWS Organizations). `infra/aws/account-setup.sh` creates the opt-out policy. Until it is in place and its effective policy shows `optOut`, no child audio goes to Transcribe.
- No audio is written to S3, logs or databases by WordLight (see PRIVACY.md). CloudWatch/app logs carry event metadata only.

## Cost guard
Goal: **zero out-of-pocket spend** — all usage covered by the account's sign-up credits. Joining AWS Organizations (needed for the AI opt-out) moved the account from the Free plan to the Paid plan; remaining credits still apply first (AWS Billing docs, "Choosing a plan"). Transcribe is not available on the Free plan anyway.
Monthly budget `wordlight-dev`: created at USD 30 (2026-10-05); `infra/aws/guard.sh --tighten` lowers it to USD 5 counted **before** credits, plus an e-mail alert at USD 1 of usage. `guard.sh` (no flag) checks Polly/Transcribe access, the opt-out, running EC2 instances and Elastic IPs. Stop the server after every session (`deploy.sh --stop`); `deploy.sh --delete` also releases the Elastic IP. Usage estimate (INFERRED, not measured): Polly < USD 1, Transcribe ~USD 1–3, EC2+IP a few dollars if stopped between sessions.

## Architecture (dev) — staged
1. **Now (S4, S2 with adult/test speech):** the server runs on the Mac and calls Polly/Transcribe with the developer's credentials (least-privilege policy `infra/aws/iam-dev-policy.json`). Phones reach it through the dev tunnel — adult speech and test tones only.
2. **Before any child session:** the same Node server on **one small EC2 instance in ap-south-1**, TLS terminated on the instance (Caddy, automatic certificates), WebSocket and HTTPS on 443, an instance role instead of keys. Chosen because the server is one long-lived WebSocket process: App Runner (no WebSockets), API Gateway WebSocket + Lambda (not suited to a long Transcribe stream per turn) and Fargate + ALB (needs a domain and more parts) add cost or moving parts. Hostname for the certificate: a domain if one is available, otherwise an IP-derived DNS name (e.g. sslip.io) — DNS only; the traffic goes straight to AWS. **Template and script written (2026-10-05): `infra/aws/wordlight-dev.yaml` + `infra/aws/deploy.sh` — not yet deployed (UNTESTED).**

## Credentials
On the Mac only (`aws configure` or `aws configure sso`), never in the repo or in chat. The EC2 instance uses an IAM role.

## Deploy (reproducible)
```
aws login                         # or aws configure with an access key — on your machine only
bash infra/aws/deploy.sh          # S3 artifact bucket (private) → CloudFormation stack wordlight-dev → health check
bash infra/aws/deploy.sh          # again after changes: uploads code + built stories, restarts via SSM
bash infra/aws/deploy.sh --stop   # stop the instance when not testing (Elastic IP still billed)
bash infra/aws/deploy.sh --delete # remove everything
```
Stack: EC2 t4g.micro by default (t4g.small if memory runs short; Amazon Linux 2023, arm64) · Elastic IP · security group 80/443 only (no SSH; SSM Session Manager) · instance role: Transcribe streaming, Polly, read the artifact object · Caddy terminates TLS with a certificate for `<ip-with-dashes>.sslip.io` · Node runs `server/src/index.ts` with `NODE_ENV=production SPEECH=transcribe READING_MODE=free|echo SUMMARY=template|bedrock` (the scripted simulation refuses to start in production). The phone, the TV and child audio use only this HTTPS endpoint; the Cloudflare tunnel is not involved.

**Logs.** journald only, capped at 50 MB and kept for 7 days. There is no CloudWatch and no access log. The server
logs ids and counts, never audio and never transcript text (`DEV_TRANSCRIPTS` is never set on AWS).

**Health check.** `node tools/ops/healthcheck.ts https://<host>`. `deploy.sh` runs it after each deploy. It checks:
- TLS and the certificate
- `/healthz`
- that speech is real (not simulated)
- that the media and join links are on this host (not a tunnel)
- WSS hello and ping

**Runbook** for the day the account works: `docs/AFTER_AWS.md`. **Teardown:** `deploy.sh --stop` after each session,
and `deploy.sh --delete` at the end. Delete removes the stack (instance, Elastic IP, role, security group) and the
artifact bucket.
