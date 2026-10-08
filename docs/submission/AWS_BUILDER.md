# AWS Builder mini-challenge: AWS in WordLight

Status words: **integrated** = code and tests exist · **ran** = called successfully on our account · **measured** =
results recorded in docs/results/ (see MEASURED_RESULTS.md). Only services WordLight actually uses are listed.

```
CONTENT (build time, Mac)                         READING (live)
story text ─► Amazon Polly ─► narration mp3        phone mic ─► HTTPS/WSS ─► EC2 WordLight server ─► Amazon Transcribe
            (neural / generative)  + word times                                   │   Streaming (ap-south-1)
            Amazon Transcribe ─► word times for                                   ├─► reading engine ─► TV (Vega)
            the generative voice (alignment)                                      └─► DynamoDB: counts per session
story package ─► S3 (private) ─► EC2 ─► HTTPS ─► Vega TV                          (Bedrock parent coach: blocked, template)
```

| Service | What WordLight uses it for | Where | Status |
|---|---|---|---|
| **Amazon Transcribe Streaming** | Hears the child read back each line (en-IN, hi-IN), 16 kHz PCM from the phone, partial-result stabilisation, word timestamps → which words light | `server/src/reading/speech.ts` | integrated · ran · **measured** (S2: 169 lines; real loop) |
| **Amazon Polly — neural Kajal** | Hindi narration (rate 90 %, +6 dB, pauses between lines via SSML) with word speech marks; slow single-word **help clips**; synthetic test speech for S2 | `tools/content/narration.ts`, `tools/content/build-story.ts` | integrated · ran · **measured** (S4) |
| **Amazon Polly — generative Kajal** | Expressive English narration. It returns no speech marks, so… | `GenerativeNarration` | integrated · ran · **measured** (align-check) |
| **Amazon Transcribe (alignment)** | …word times for the generative narration come from Transcribe aligned to the known text (+ calibrated offset) | `tools/content/align.ts`, `tools/s4/align-check.ts` | integrated · ran · **measured** |
| **Amazon EC2** (t4g.micro, Graviton) + Elastic IP | The WordLight server: HTTPS/WSS for phone and TV, Caddy TLS (RSA certificate), one Transcribe stream per reading turn | `infra/aws/wordlight-dev.yaml` | deployed 2026-10-08 · **measured** (real loop, privacy audit) |
| **AWS CloudFormation** | One stack: instance, IP, security group, role, DynamoDB table | same | deployed |
| **AWS IAM** (instance role) | No keys on the server; Transcribe streaming, Polly, read one S3 object, DynamoDB on one table | same | deployed |
| **AWS Systems Manager** | Code updates without SSH (`send-command`) | `infra/aws/deploy.sh`, `on-update.sh` | deployed |
| **Amazon S3** | Private artifact bucket for the code and built stories (public access blocked) | `deploy.sh` | deployed |
| **Amazon DynamoDB** (on-demand, TTL) | Per-session counts only (words read/helped/skipped, story, duration) — never audio or text | `server/src/progress.ts` | deployed · see MEASURED_RESULTS |
| **AWS Organizations** — AI services opt-out | Opt out of content use for service improvement, because the users are children | `infra/aws/account-setup.sh` | ran 2026-10-05 |
| **AWS Budgets** + Cost Explorer | USD 100 project ceiling (gross, before credits), alerts at 60/80/90/95; spend snapshots in the phase scripts | `tools/aws/budget-policy.sh`, `cost-report.ts` | ran |
| **Amazon Bedrock** | Parent "reading coach" summary from counts only, with numeric/claim guard and template fallback | `server/src/summary.ts`, `tools/bedrock/bench.ts` | integrated · **blocked**: account `NOT_AUTHORIZED` (docs/AWS_BEDROCK_SUPPORT.md) |

## Decisions the measurements drove
- **Echo Mode.** Transcribe recognised ≈ 95 % of words eventually but only ≈ 51 % within 1 s of the word start
  (169 lines). Free reading (child reads first) would feel late, so the TV reads the line and the child repeats it.
  The historical result stays in the record (MEASURED_RESULTS.md, S2).
- **Stability "high".** "none" was faster (58.8 % within 1 s) but accepted one more Hindi misread; a rule fixed before
  the run kept "high".
- **Generative English voice with Transcribe alignment.** Polly speech marks were within 50 ms for 53 % of words
  (S4: FAIL against our 95 % target). The expressive voice + alignment measured a 40 ms median error vs 52 ms for
  speech marks on the same pages, so it was adopted by a rule fixed before the run; it is not an S4 pass.
- **One small instance.** Long-lived WebSockets and one Transcribe stream per turn; ≈ USD 0.015/h running, idle
  auto-stop after 90 min.

## Cost
Total so far: see MEASURED_RESULTS.md → Spend (all inside the USD 100 ceiling with the USD 50 reserve untouched).

## Product feedback
PRODUCT_FEEDBACK.md (AWS sections) and docs/FRICTION_LOG.md (W6–W8, W10–W12).
