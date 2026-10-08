# Measured results

Labels:
- **MEASURED**: read from instrumentation.
- **INFERRED**: derived from measurements, with the reasoning given.
- **UNKNOWN**: not measured.
- **SIMULATED**: produced by a local script. Never evidence about real services.

Nothing on this page comes from a child: no child has used WordLight.

## S1 — narration and word highlight in sync on Vega
| | |
|---|---|
| Measurement | Offset between a word lighting on screen and its sound (+ = light after sound) |
| Device | Vega Virtual Device (SDK 0.24.12112, w3cmedia 2.3.2) on a MacBook Pro (arm64, macOS 26.3.1), Mac speakers |
| Platform | WordLight S1 build: W3C `AudioPlayer`, `PlayheadSampler` polling every 20 ms |
| Method | Click track with clicks at known word times, plus a white flash on each word change. macOS screen recording with the Mac microphone, analysed by `tools/audio-analysis/av_offset.py`. The analyser was validated on synthetic recordings with known offsets (bias −2 to −3 ms) |
| Sample | 242 word pairs over 177.5 s (M4A, `leadMs = −339`); uncalibrated runs 253/253 words (MP3 and M4A) |
| Result | **Median −1.0 ms, SD 11.2 ms, drift −0.83 ms/min**. First vs last minute: +0.1 vs −2.2 ms. Uncalibrated offsets were −392 ms (MP3) and −339 ms (M4A), which the lead cancels. Recording chain alone: −28.4 ms (QuickTime check), so the viewer-perceived offset is INFERRED ≈ +27 ms. Devanagari rendering and D-pad: PASS (visual) |
| Status | **MEASURED** on the VVD · physical Fire TV **UNKNOWN** |

## S3 — phone microphone to server
| | |
|---|---|
| Measurement | Audio chunk integrity and latency, from capture on the phone to arrival at the server (phone clock mapped to the server by NTP-style sync) |
| Device | iPhone, Safari 26.6 (iOS) · Android 10, Chrome 154 |
| Platform | WordLight phone page: AudioWorklet resampled to 16 kHz PCM16, sent over WSS through the development HTTPS tunnel to the Mac server |
| Method | `npm run s3` plans: chunk sweep 20/40/60/100 ms, a 10-minute endurance turn, and interruption tests (Wi-Fi off, lock, app switch, reload). Sequence numbers and tags are checked on the server, and a browser-API microphone audit runs |
| Sample | ≈ 52 000 chunks over 4 runs (2 phones × 2 runs) |
| Result | **0 lost, 0 duplicated, 0 out of order.** Capture → server median **50–90 ms** (40 ms chunks), p95 ≤ 210 ms. The mic stopped at the interruption itself in every case tested. **0 privacy-audit violations** (> 2 300 status reports) |
| Status | **MEASURED** (dev tunnel path) · on the AWS endpoint: **UNKNOWN** · iPhone reload, wake lock during an untouched 10 minutes, cause of 1 Android reconnect: **UNKNOWN** |

## S4 — Polly word timing
| | |
|---|---|
| Measurement | Polly word speech-mark start vs the word's start in the audio |
| Device / platform | Amazon Polly neural, voice Kajal, hi-IN and en-IN, ap-south-1, 2026-10-08 |
| Method | `tools/s4/analyze.py`, two references: (A) Transcribe word starts on the same PCM, whose own error is UNKNOWN, so A bounds the combined error; (B) acoustic onsets after pauses, which are exact but cover fewer words. Target ≥ 95 % of words within 50 ms per language (fixed in advance) |
| Sample | 6 original passages: 229 words matched on A, 90 onsets on B. Audio was byte-identical across repeated syntheses |
| Result | **FAIL.** B: **53.3 %** within 50 ms, median \|error\| 40 ms, p95 159 ms, bias +5 ms. A: 39.7 % (hi-IN 30.5 %, en-IN 52.0 %), median 64 ms, bias +59 ms. Report: `docs/results/s4/2026-10-08T12-48/` |
| Status | **MEASURED.** Consequence: story timings are not marked "verified". Highlights follow Polly's marks, which are typically within ~40 ms but sometimes ~150 ms off. Whether children notice this is **UNKNOWN** |

## S2 — speech recognition in the reading loop
| | |
|---|---|
| Measurement | Share of correctly read words lit within 1 s of the word's START · share of deliberately misread words accepted |
| Device / platform | Amazon Polly Kajal (adult synthetic voice) → Amazon Transcribe Streaming (hi-IN, en-IN, ap-south-1, stability high) → WordLight reading engine, 2026-10-08 |
| Method | `tools/s2/eval.ts`, 169 cases (correct, slip, missing, repeated, hesitation, long pause, wrong, multiple wrong, correction, Hindi Unicode, English edge cases), streamed in real time as 40 ms frames. Pass rule fixed in advance: ≥ 90 % within 1 s and ≤ 10 % misreads accepted, per language |
| Sample | 169 cases, 836 words that should light |
| Result | **FAIL.** Lit within 1 s: **50.9 %** (en-IN 49.3 %, hi-IN 52.6 %). Misreads accepted: **6.7 %** (en-IN 12 %, hi-IN 0 %). Latency median **976 ms**, p95 1 556 ms. Words after the first: 94.8 % recognised eventually. First words of a line: weaker (Transcribe often returned only the end of the line, e.g. "Kite" for "Tara had a red kite"). Names were misheard (Tara→Sarah, Anu→"A who"). Report: `docs/results/s2/polly-transcribe-2026-10-08T12-33-02/` |
| Status | **MEASURED** for an adult synthetic voice. The main failure is **latency, not accuracy**. By the predefined rule, the server runs **Echo Mode** (deployed 2026-10-08). A follow-up (phase A2: silence before the speech as on a phone, Transcribe stability settings) will be reported here beside this result, without replacing it. Child speech: **UNKNOWN** (protocol in docs/CHILD_TESTING.md) |

## Bedrock — Personalized Reading Coach
| | |
|---|---|
| Result | 2026-10-08, ap-south-1: every candidate model (Nova Micro/Lite through the APAC inference profile, Ministral 3B/8B/14B) returned **AccessDeniedException**. 0 accepted, so the deterministic template summary is used. The error text is being captured in phase A2 |
| Status | **MEASURED** (refused). AI summary quality: **UNKNOWN** |

## Spend
| | |
|---|---|
| Result | After phase A: Polly 17 566 characters, Transcribe 10.6 min, 5 Bedrock calls (refused) → **≈ USD 0.54** at list price (**INFERRED** from the local meter), plus the EC2 t4g.micro from deployment onwards. Cost Explorer: no data yet (new account) |

## End to end — child speaks a word → the TV lights it
| | |
|---|---|
| Measurement | TV `word-lit` time − word spoken time (recogniser word start, mapped through the phone's capture clock) |
| Method | `tools/e2e/word-lit-latency.ts https://<aws-host> <session>` |
| Result | — |
| Status | **UNKNOWN.** INFERRED lower bound from parts measured so far: phone → server ≈ 50–90 ms (S3, tunnel path) plus Transcribe partial-result latency (UNKNOWN) plus server → TV (UNKNOWN on AWS) |
