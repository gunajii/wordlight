# Submission checklist

Official deadline: **2026-10-23, 12:00 PM PDT**. Submit as soon as everything below is ticked.
✅ done · ⬜ to do (owner)

## Primary track (Fire TV / Vega)
- ✅ Latest build runs on the Vega Virtual Device on the real AWS path (English and Hindi, 2026-10-09)
- ⬜ Physical Vega Fire TV — only if available; otherwise say “Vega Virtual Device” everywhere (it is said)
- ✅ Demo path uses real Transcribe (no SIMULATED badge on this path)
- ⬜ Repository public (developer) — README has setup and run instructions

## Video (< 3 minutes, public)
- ⬜ Record with `tools/demo/real-demo.sh` following DEMO_SCRIPT.md (developer)
- ⬜ Core loop before 2:00 · no child's face/voice/name without written permission (adult reader) · uploaded public

## Documentation
- ✅ README · ARCHITECTURE · TEST_PLAN · PRIVACY · SECURITY · MEASURED_RESULTS (every number labelled)
- ✅ Hindi review (docs/HINDI_REVIEW.md); p2/p4 wording kept by the developer

## AWS Builder
- ✅ Services listed only if they ran (AWS_BUILDER.md); Bedrock marked blocked
- ✅ Product feedback for each tool/API/SDK used (PRODUCT_FEEDBACK.md)
- ⬜ `bash tools/aws/final-checks.sh` (developer): opt-out effective policy, DynamoDB record present, spend by service

## Open Source
- ✅ github.com/gunajii/karaoke-vega (MIT, README, 11 tests, example, CI) — unchanged since publication, so in sync
- ⬜ Repository URL, username `gunajii` and description in Devpost

## Friction log
- ✅ docs/FRICTION_LOG.md W1–W19, real entries only

## Content
- ✅ Busy Ants credits verbatim from StoryWeaver's attribution file; shown on the end card and in docs/CONTENT.md
- ✅ Our test story (Mina's Red Kite) is off the demo shelf

## Privacy and security
- ✅ No audio or transcript text stored; mic audit 0/561 on AWS; child audio only via the AWS endpoint
- ✅ Repository secret scan clean (2026-10-09)
- ⬜ Root password changed + MFA, no root access keys; daily work with the limited IAM user (developer, docs/SECURITY.md)

## Cost
- ✅ ≈ USD 2 of the USD 100 ceiling (INFERRED from meters; ⬜ confirm with final-checks.sh) · reserve untouched
- ⬜ Stop the server after the recording (`bash infra/aws/deploy.sh --stop`)

## Devpost form
- ⬜ Track: Fire TV · mini-challenges: AWS Builder, Open Source (+ friction log)
- ⬜ Text from PROJECT_DESCRIPTION.md · screenshots: Your Turn (green + amber + ✓), end card, phone consent, shelf
