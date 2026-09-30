# AWS — development path (2026-09-30)

## Region: ap-south-1 (Mumbai) — verified against current AWS docs
| Need | ap-south-1 | Source |
|---|---|---|
| Transcribe **streaming**, hi-IN and en-IN | yes — streaming endpoint `transcribestreaming.ap-south-1.amazonaws.com`; hi-IN and en-IN list "batch, streaming"; the regions excluded for these languages are af-south-1, ap-northeast-1, ap-southeast-5, ap-southeast-7, cn-northwest-1 (not Mumbai) | docs.aws.amazon.com/general/latest/gr/transcribe.html · transcribe/latest/dg/supported-languages.html |
| Polly **neural** + Kajal (hi-IN, en-IN) | neural voices are offered in ap-south-1; Kajal is neural for hi-IN and en-IN (en-IN also generative) | polly/latest/dg/neural-voices.html · available-voices.html |
| Bedrock | not verified yet (not needed until after S2/S4) | — |

Runtime check, not assumed: `tools/s4/polly-s4.ts` calls `DescribeVoices` and stops if Kajal (neural) is not offered in the region.

## Privacy settings on the account
- AWS AI services **may store and use customer content to improve the service** unless the account opts out; Transcribe and Polly are both covered by the AI services opt-out policy (AWS Organizations). `infra/aws/account-setup.sh` creates the opt-out policy. Until it is in place and its effective policy shows `optOut`, no child audio goes to Transcribe.
- No audio is written to S3, logs or databases by WordLight (see PRIVACY.md). CloudWatch/app logs carry event metadata only.

## Cost guard
Monthly budget `wordlight-dev`, USD 30, e-mail alerts at 80 % actual and 100 % forecast (`account-setup.sh --email …`).

## Architecture (dev) — staged
1. **Now (S4, S2 with adult/test speech):** the server runs on the Mac and calls Polly/Transcribe with the developer's credentials (least-privilege policy `infra/aws/iam-dev-policy.json`). Phones reach it through the dev tunnel — adult speech and test tones only.
2. **Before any child session:** the same Node server on **one small EC2 instance in ap-south-1**, TLS terminated on the instance (Caddy, automatic certificates), WebSocket and HTTPS on 443, an instance role instead of keys. Chosen because the server is one long-lived WebSocket process: App Runner (no WebSockets), API Gateway WebSocket + Lambda (not suited to a long Transcribe stream per turn) and Fargate + ALB (needs a domain and more parts) add cost or moving parts. Hostname for the certificate: a domain if one is available, otherwise an IP-derived DNS name (e.g. sslip.io) — DNS only; the traffic goes straight to AWS. **Not built yet — decision recorded, UNTESTED.**

## Credentials
On the Mac only (`aws configure` or `aws configure sso`), never in the repo or in chat. The EC2 instance uses an IAM role.
