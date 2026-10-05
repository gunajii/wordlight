# Submission checklist

Official deadline: **2026-10-23, 12:00 PM PDT**. Internal target: as soon as everything below is true.
Freeze features once it is.

## Primary track (Fire TV / Vega)
- [ ] Latest build runs on the **Vega Virtual Device** (`bash tools/vvd/run-tv.sh`): shelf, story, audio, highlight, Your Turn, help, resume, end card
- [ ] Physical Vega Fire TV: only if one is available. Report it separately; never imply it if not
- [ ] The demo uses the **real AWS path** (Transcribe), or the video says plainly that speech is simulated
- [ ] Repository public, with setup and run instructions (README → Run it)

## Video (< 3 minutes, public)
- [ ] Shows the app running on the Vega Virtual Device (or Fire TV)
- [ ] The core loop appears within the first 2 minutes
- [ ] No SIMULATED SPEECH badge visible, unless the narration says it is simulated
- [ ] No child's face, voice or name without written parent permission (adult reader otherwise)
- [ ] Uploaded and public (YouTube/Vimeo); link in Devpost

## Documentation
- [ ] README (status table current)
- [ ] Architecture (docs/ARCHITECTURE.md)
- [ ] Testing (docs/TEST_PLAN.md)
- [ ] Privacy (docs/PRIVACY.md, docs/submission/PRIVACY.md)
- [ ] Measured results (docs/submission/MEASURED_RESULTS.md): every number labelled

## AWS Builder mini-challenge
- [ ] AWS services actually used are listed with their integration (docs/submission/AWS_BUILDER.md): Polly, Transcribe, EC2/CloudFormation/IAM/SSM/S3, Organizations AI opt-out, Budgets
- [ ] Each one confirmed working on the account (no service listed as "used" if it never ran)
- [ ] Product feedback for each tool/API/SDK used (docs/submission/PRODUCT_FEEDBACK.md)

## Open Source mini-challenge
- [ ] `@wordlight/karaoke-vega` in its **own public GitHub repository** (docs/submission/OPEN_SOURCE.md has the commands)
- [ ] LICENSE (MIT) · README · tests passing · example
- [ ] Repository URL, GitHub username and description in Devpost
- [ ] Optional: published to npm

## Friction log
- [ ] docs/FRICTION_LOG.md: real entries only (W1–W9 so far), each with date, environment, expected/actual, workaround

## Content
- [ ] One real StoryWeaver story: credits checked on the StoryWeaver page (author, illustrator, licence, URL)
- [ ] Attribution shown in the app and in docs/CONTENT.md
- [ ] The test story stays hidden from the shelf in the real demo

## Privacy
- [ ] No raw child audio stored anywhere (server, logs, repo)
- [ ] Child audio only through the AWS endpoint (health check passed)
- [ ] AI opt-out effective policy shows `optOut`

## Evidence
- [ ] S1 (VVD) · S3 (phones) · S4 (Polly) · S2 (Transcribe) · end-to-end latency
- [ ] Every claim in the Devpost text traced to MEASURED_RESULTS.md

## Devpost form
- [ ] Track: Fire TV · mini-challenges: AWS Builder, Open Source (and the friction log bonus)
- [ ] Text from docs/submission/PROJECT_DESCRIPTION.md (with numbers filled in from measured results only)
- [ ] Screenshots: shelf, Your Turn with green and amber words, end card, phone consent screen
- [ ] AWS services and Open Source details filled in
