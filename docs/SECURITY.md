# Security

## Credentials (2026-10-09)
- **Exposed in chat earlier:** a password was typed into the development chat (2026-10-0x). Treat it as compromised.
- **Repository scan (MEASURED 2026-10-09):** current tree and full history searched for AWS access-key IDs (AKIA/ASIA),
  `aws_secret_access_key`, session tokens, private keys and the exposed password → **no matches**. The operator admin
  token (`.dev/aws/admin-token`) does not occur anywhere in history. `.env`, `.env.*` and `.dev/` are gitignored.
- AWS credentials live only in the developer's Mac CLI configuration; nothing in this repository reads or stores
  them. The EC2 server uses an instance role (no keys on the instance).

## Steps for the developer (cannot be done from Claude's workspace)
1. **Change the root password** (AWS console → account menu → Security credentials → Update password) and turn on
   **MFA for root** on the same page.
2. **Root access keys:** on the same page, make sure "Access keys" is empty; delete any that exist.
3. **Change the password exposed in chat** wherever it was used (and never reuse it).
4. **Create a least-privilege identity for day-to-day work** (IAM → Users → Create user, no console access; attach an
   inline policy from `infra/aws/iam-dev-policy.json`). It can: Polly, Transcribe, Bedrock invoke/list; start/stop and
   update ONLY the instance tagged `wordlight-dev`; write the code bucket `wordlight-dev-artifacts-*`; read the stack,
   costs and budgets. It cannot create or delete stacks, IAM, or other instances — creating/deleting the stack stays an
   admin task. Then `aws configure --profile wordlight` with that user's access key (or Identity Center:
   `aws configure sso`) and `export AWS_PROFILE=wordlight` before the phase scripts.
5. Run `aws sts get-caller-identity` — the ARN must no longer end in `:root`.

## Server
HTTPS only (Caddy, Let's Encrypt RSA certificate), instance role, no SSH (SSM only), security group 80/443 only,
operator endpoints require the `x-wordlight-admin` header, no audio or transcript text stored (traces keep numbers
only), journald capped at 50 MB / 7 days, idle auto-stop. See docs/PRIVACY.md.
