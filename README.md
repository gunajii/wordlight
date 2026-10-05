# WordLight

> **The TV already has the words. WordLight teaches your child to read them.**

WordLight is a Fire TV (Vega OS) read-along app for children aged about 6–10.

1. The family watches a short illustrated story. Each word lights up as it is narrated.
2. At a marked line the TV says **"Riya, your turn"**. The child reads the line aloud into a paired phone (scan a QR
   code; no app to install), and the words light on the TV as the child says them.
3. If the child stalls for about 3 seconds, the TV says the next word and marks it amber. Nothing is ever marked
   wrong.
4. The parent gets a plain summary: words read independently, and words that needed help.

WordLight builds on the idea of same-language subtitling
([UNESCO LitBase](https://www.uil.unesco.org/en/litbase/reading-billion-same-language-subtitling-india)).
**This prototype has not demonstrated any reading improvement, and we don't claim one.**

## Status (2026-10-05)

| Area | State |
|---|---|
| S1: highlight in sync with narration on Vega | **PASS on the Vega Virtual Device**: calibrated median −1.0 ms, SD ≈ 11 ms, drift −0.8 ms/min. Physical Fire TV: UNKNOWN |
| S3: phone microphone (iPhone Safari, Android Chrome) | **PASS for the tested conditions**: ≈ 52 000 chunks, 0 lost; capture → server median 50–90 ms; mic off on every interruption tested |
| S2: speech recognition (Amazon Transcribe) | **Not measured.** Harness and 169 cases are ready; waiting for AWS access. Fallback: Echo Mode (built) |
| S4: Polly word timing | **Not measured.** Pipeline and report are ready; waiting for AWS access |
| Core loop (narration → Your Turn → words light → help → resume → summary) | Works end to end with a **scripted local simulation** (`npm run demo:check`), and in tests |
| AWS deployment (EC2 + TLS + Transcribe/Polly role) | Template, deploy script and health check are written; not deployed |
| Latest TV app build | Type-checks; **not yet run on the Virtual Device** |

Everything simulated is labelled SIMULATED: in reports, on the TV, and on the phone.

## Run it
Needs Node ≥ 22.18. The TV app needs the Vega SDK (macOS).
```bash
npm install
npm test                       # 165 tests
npm run typecheck
npm run demo:check             # headless end-to-end loop, LOCAL SIMULATION (no AWS)
npm run demo:local             # server + https tunnel + scripted reader, for the Virtual Device (SIMULATED speech)
bash tools/vvd/run-tv.sh       # build + launch the TV app on the Vega Virtual Device
npm start                      # real server (SPEECH=transcribe, needs AWS credentials)
```
AWS steps, in order: [docs/AFTER_AWS.md](docs/AFTER_AWS.md). Deploy: `bash infra/aws/deploy.sh`.

## Repository
| Path | What |
|---|---|
| `apps/vega-tv/` | Vega TV app (React Native for Vega): shelf, story player, Your Turn, end card, diagnostics |
| `web/phone/` | Phone web page: consent, reader profile, microphone during turns only, summary |
| `server/` | Session server: pairing, events, reading pipeline (speech service → reading engine), content checks, summary |
| `packages/reading-engine` | Deterministic, strict matcher: Hindi/English normalisation, help on stall, never backwards |
| `packages/tv-core` | Your Turn state machine, playback plan (free/echo stop points), end-card counts |
| `packages/story-package` | Story format, validator, turn-line choice, fixture narration |
| `packages/shared-protocol`, `packages/session-client` | Events and audio frames; WebSocket client with clock sync (reused from the author's Earshot project) |
| `oss/karaoke-vega` | **Open-source package** `@wordlight/karaoke-vega`: word-timed subtitles for Vega (MIT) |
| `tools/s2`, `tools/s4`, `tools/s3`, `tools/s1-run` | Measurement harnesses |
| `tools/content` | StoryWeaver ePub import, story build (Polly or fixture), validation |
| `infra/aws` | CloudFormation, deploy, account setup, cost guard |
| `docs/` | Spikes, test plan, privacy, AWS, content, friction log, child-testing protocol, submission drafts |

## Privacy
- The phone's microphone is on **only during a reading turn**, after a parent agrees on the phone. The page always
  shows whether it is ON or OFF.
- Audio goes to Amazon Transcribe for recognition and is not stored by WordLight. Only per-word outcomes are kept.
- Child audio only ever goes through the AWS HTTPS endpoint, never the development tunnel.

Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Attribution
- Story sources and licences: [docs/CONTENT.md](docs/CONTENT.md).
- Noto Sans Devanagari: SIL OFL.
- Code reused from Earshot: [docs/REUSED.md](docs/REUSED.md).

## Licence
MIT
