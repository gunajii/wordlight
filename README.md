# WordLight

> **The TV already has the words. WordLight teaches your child to read them.**

WordLight turns a family Fire TV into a reading stage for children aged about 6–10: the TV narrates an illustrated
story and lights each word as it is spoken; at a marked line it says **“Riya, now you say it”**, and the child reads
the line back into a paired phone. Amazon Transcribe hears the child, a strict reading engine lights the words she
actually says, and if she gets stuck the TV gently says the word — then gives her the chance to say it herself.
Nothing is ever marked wrong.

WordLight is designed around same-language subtitling
([UNESCO LitBase](https://www.uil.unesco.org/en/litbase/reading-billion-same-language-subtitling-india)).
**We have not measured any effect on children's reading and claim none. No child has used WordLight yet.**

## How it works
1. **Pair:** the TV shows a QR code; a parent scans it (no app install), agrees to the microphone rule, and adds the
   reader (first name, age, language).
2. **Listen:** the story plays — Amazon Polly narration, each word lit on time (`@wordlight/karaoke-vega`).
3. **Your turn (Echo Mode):** the TV reads a line, stops, and the child says it back. Words light green as the child
   says them (≈ 1.1–1.2 s after each word — that is the speech recogniser's latency, measured).
4. **Help, not judgement:** after ≈ 3 s of quiet (sound such as a stutter keeps it waiting, up to 6 s) the TV says the
   next word from a slow, clear clip and marks it amber; the child can then say it back (✓) before the line moves on.
5. **Well read!** — the TV and the parent's phone show what really happened: words read on their own, words that
   needed a little help.

Why Echo Mode: our measurements showed Amazon Transcribe recognises ≈ 95 % of words but typically ~1 s after they
are spoken, too late for “the child reads first” (only ≈ 51 % lit within 1 s across 169 test lines). Hearing the line
first and then saying it is a deliberate guided-reading design, not a hidden fallback. Details:
[docs/submission/MEASURED_RESULTS.md](docs/submission/MEASURED_RESULTS.md).

## Stories
- **Busy Ants** (English) — Kanchan Bannerjee, illustrated by Deepa Balsavar, Pratham Books, CC BY 4.0, via
  StoryWeaver. Narrated by Amazon Polly's expressive (generative) Kajal voice.
- **व्यस्त चींटियाँ** (Hindi) — our own unofficial translation of Busy Ants (CC BY 4.0), narrated by Polly neural Kajal.
Credits are shown in the app and in [docs/CONTENT.md](docs/CONTENT.md).

## What is real and what was measured (2026-10-09)
| | Result | Label |
|---|---|---|
| Narration ↔ highlight sync on the Vega Virtual Device (S1) | median −1.0 ms, SD 11 ms after calibration | MEASURED (VVD). Physical Fire TV: UNKNOWN |
| Phone microphone streaming (S3, iPhone + Android) | ≈ 52 000 chunks, 0 lost; capture → server 50–90 ms | MEASURED |
| Polly word timing (S4) | 53 % of words within 50 ms (target 95 %) — **FAIL**; English now uses the generative voice with Transcribe-aligned timings (median 40 ms vs 52 ms) | MEASURED |
| Transcribe in the reading loop (S2, 169 lines, synthetic adult voice) | ≈ 95 % recognised, 51 % within 1 s — **FAIL for free reading** → Echo Mode | MEASURED |
| Real loop: phone → AWS → Transcribe → TV (adult tester) | word lit a median 1.08 s after spoken (n = 76, 4 sessions); target ≤ 1 s not met | MEASURED |
| Help recovery (next word helped too early) | 1/20 → 0/20 after the fix (synthetic reader, real Transcribe) | MEASURED |
| Privacy audit on AWS | 0 violations in 790 microphone reports (4 sessions); mic off 8–107 ms after each turn end | MEASURED |
| Children | not tested | UNKNOWN |

## Run it
Needs Node ≥ 22.18; the TV app needs the Vega SDK (macOS).
```bash
git clone https://github.com/gunajii/wordlight && cd wordlight
npm install && npm test        # 197 tests, no AWS needed
npm run demo:check             # headless loop with a LOCAL SIMULATION of speech (labelled SIMULATED)

# TV app (macOS + Vega SDK 0.24): generate the Vega project once, then build + launch on the Virtual Device
bash apps/vega-tv/setup.sh
npm run demo:local             # local server + scripted reader (SIMULATED speech), then in a second terminal:
bash tools/vvd/run-tv.sh

# the real path (needs your AWS account): deploy once, then each demo starts the server, runs, and stops it
bash infra/aws/deploy.sh
bash tools/demo/real-demo.sh   # AWS server + Amazon Transcribe + Vega Virtual Device + your phone
```
AWS: `bash infra/aws/deploy.sh` (CloudFormation + SSM), checks with `node tools/ops/healthcheck.ts https://<host>`.
Measurement scripts: `tools/aws/phase-*.sh`. Everything simulated is labelled SIMULATED on screen and in reports.

## Repository
| Path | What |
|---|---|
| `apps/vega-tv/` | Vega TV app (React Native for Vega): shelf, story player, Your Turn, help, end card, diagnostics (↑) |
| `web/phone/` | Phone page: consent, reader, microphone during turns only, summary |
| `server/` | Session server: pairing, events, Transcribe pipeline, voice activity, reading driver, summary, DynamoDB progress |
| `packages/reading-engine` | Deterministic, strict matcher (Hindi/English), stall/help/say-it-back rules |
| `packages/tv-core` | Your Turn state machine, playback plan (echo stop points), child-facing text (English/Hindi) |
| `packages/story-package` | Story format, validator, SSML narration mapping, turn-line choice |
| `oss/karaoke-vega` | **Open source:** `@wordlight/karaoke-vega` — word-timed subtitles for Vega (MIT), also at github.com/gunajii/karaoke-vega |
| `tools/` | Content pipeline (StoryWeaver → Polly → story package), measurement harnesses (S1–S4, help recovery, e2e) |
| `infra/aws/` | CloudFormation, deploy, start/stop, cost guard, least-privilege policy |
| `docs/` | Architecture, privacy, security, measured results, friction log (W1–W19), Hindi review, submission texts |
| `content/stories/` | The two demo stories with their built media (see THIRD_PARTY_NOTICES.md) |

## Privacy
The phone microphone is on **only during a reading turn**, after a parent agrees, and the phone always shows it.
Audio goes only to the WordLight server on AWS (HTTPS) and on to Amazon Transcribe; WordLight stores no audio and no
transcript text — only counts. [docs/PRIVACY.md](docs/PRIVACY.md) · [docs/SECURITY.md](docs/SECURITY.md)

## Licence and attribution
Code: MIT (`LICENSE`). Stories CC BY 4.0 (Pratham Books / StoryWeaver; Hindi translation ours), narration generated
with Amazon Polly, Noto Sans Devanagari under SIL OFL — details in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Code reused from the author's Earshot project: [docs/REUSED.md](docs/REUSED.md).
