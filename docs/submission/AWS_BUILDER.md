# AWS Builder mini-challenge: AWS in WordLight

Status meanings:
- **integrated**: code and tests exist.
- **ran**: called successfully on the account.
- **measured**: results recorded.

As of 2026-10-05 the account could not call Polly or Transcribe yet (W6–W8 in the friction log). Update this table
the day they run.

| Service | What WordLight uses it for | Where | Status |
|---|---|---|---|
| **Amazon Transcribe Streaming** | Recognises the child's reading in real time (hi-IN, en-IN) from 16 kHz PCM, with partial-result stabilisation and word timestamps. This drives which words light | `server/src/reading/speech.ts` (`TranscribeSource`) | integrated · ran ☐ · measured (S2) ☐ |
| **Amazon Polly** (neural, Kajal) | Story narration (mp3) plus word speech marks, which become the word-highlight timings; also synthetic test speech for S2 | `tools/content/narration.ts`, `tools/s4/polly-s4.ts`, `tools/s2/eval.ts` | integrated · ran ☐ · measured (S4) ☐ |
| **Amazon EC2** + Elastic IP | The WordLight server (HTTPS/WSS) that phones, TV and Transcribe connect through. Child audio uses only this path | `infra/aws/wordlight-dev.yaml` | integrated · deployed ☐ |
| **AWS CloudFormation** | One stack: instance, IP, security group, role | same | integrated · deployed ☐ |
| **AWS IAM** (instance role) | No keys on the server. Least-privilege: Transcribe streaming, Polly, read one S3 object, optional Bedrock | same | integrated |
| **AWS Systems Manager** | Updates and administration without SSH (`send-command`) | `infra/aws/deploy.sh` | integrated |
| **Amazon S3** | A private artifact bucket for code and built stories (public access blocked) | `deploy.sh` | integrated |
| **AWS Organizations**: AI services opt-out policy | Opts the account out of Transcribe/Polly content use for service improvement, because the users are children | `infra/aws/account-setup.sh` | ran (policy attached 2026-10-05; effective policy check pending) |
| **AWS Budgets** | Cost guard: USD 5/month gross, with an alert at USD 1 | `account-setup.sh`, `guard.sh` | ran (budget created) |
| **Amazon Bedrock** (optional) | Rewords the parent summary from counts. Guarded: timeout, call budget, numbers must match, no claims; template fallback | `server/src/summary.ts` | integrated · disabled by default · ran ☐ |

## Why these choices
- **Streaming recognition**: a word has to light while the child is still reading. That is why we use Transcribe
  Streaming and not batch jobs.
- **Speech marks**: Polly gives word timings with the audio, so every story's highlight is generated, not hand-timed.
- **One small instance**: the server holds long-lived WebSockets and one Transcribe stream per turn. App Runner
  (no WebSockets) and Lambda were poorer fits (docs/AWS.md).
- **Opt-out before child audio**: required by our privacy rules (docs/PRIVACY.md).

## Product feedback
docs/submission/PRODUCT_FEEDBACK.md (AWS sections) and docs/FRICTION_LOG.md (W6–W8).
