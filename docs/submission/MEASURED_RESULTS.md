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
| Status | **MEASURED** for an adult synthetic voice. The main failure is **latency, not accuracy**. By the predefined rule, the server runs **Echo Mode** (deployed 2026-10-08). Follow-up below. Child speech: **UNKNOWN** (protocol in docs/CHILD_TESTING.md) |

### S2 follow-up (phase A2, 2026-10-08) — reported beside phase A, not replacing it
| | |
|---|---|
| Question | Is the delay caused by our harness (speech started at t = 0, while a real phone streams silence first) or by a Transcribe setting? |
| Method | The same 40-case sample, the same cached Polly audio and the same metric, in 5 configurations. Then the configuration picked by a rule fixed in advance was run on all 169 cases. Table: `docs/results/s2/experiment-20261008T125733Z.md` |
| Result: harness repeat | Phase A setting on the sample: 54.4 % lit within 1 s (phase A, all 169 cases: 50.9 %). The two runs are consistent |
| Result: lead silence | 600 ms of silence first: **no improvement** (46.1 % within 1 s, first word lit 84.6 % vs 89.7 % without it). The hypothesis is **rejected**: the first-word losses are not a harness artifact |
| Result: stability | high 46.1 % · medium 47.1 % · low 44.6 % · **none 63.7 %** (median latency 708 ms vs 1 000 ms; from the word END 451 ms vs 740 ms, INFERRED) |
| Pick rule | It excluded every configuration. The sample holds only 9 misread words, so one word is 11 points, and even the repeat of the phase A setting showed 22 %. Result: "keep high". This weakness is in our sample design and is recorded as found |
| Result: 169 cases, high + 600 ms | **FAIL**: 49.2 % within 1 s (en 47.7 %, hi 50.7 %), misreads accepted 8.9 % (4/45), median 989 ms. Recognised eventually: 95 %. From the word END (INFERRED): median 720 ms, 85.6 % within 1 s |
| Result: 169 cases, none + 600 ms (phase A3) | **FAIL**: 58.8 % within 1 s (en 60.6 %, hi 57 %), misreads accepted 11.1 % (5/45: en 4/25, hi 1/20), median 798 ms but p95 1 883 ms (high: 1 553). From the word END (INFERRED): median 524 ms |
| Decision (rule committed before phase A3) | "none" only if more words lit within 1 s AND no more misreads accepted in either language. It accepted one more Hindi misread (काल heard as कल), so the server keeps **stability high**. **Echo Mode** stays. Redeployed 2026-10-08 with the latest code; health check OK |
| What this means | With adult synthetic speech, Transcribe streaming recognises about 95 % of words eventually, but typically 0.7–1 s after the word starts. The 1-second-from-start target isn't met with any setting we tried. The highlight will trail the reader. Echo Mode keeps the turn understandable: the child has just heard the line, and the highlight confirms rather than leads. Child speech: **UNKNOWN** |

## Bedrock — Personalized Reading Coach
| | |
|---|---|
| Result | 2026-10-08, ap-south-1: every candidate model (Nova Micro/Lite through the APAC inference profile, Ministral 3B/8B/14B) was refused, so the deterministic template summary is used. Phase A2 captured the exact message for a bare `Converse` call: `ValidationException: Operation not allowed` (Nova Micro directly and through APAC, Nova Lite, Ministral 3B). `GetFoundationModelAvailability` for Nova Micro: region, entitlement and agreement AVAILABLE, **authorizationStatus NOT_AUTHORIZED**. The block is at account level, not a missing model enablement |
| Status | **MEASURED** (refused). AI summary quality: **UNKNOWN** |

## Spend
| | |
|---|---|
| Result | After phase A: Polly 17 566 characters, Transcribe 10.6 min, 5 Bedrock calls (refused) → **≈ USD 0.54** at list price (**INFERRED** from the local meter), plus the EC2 t4g.micro from deployment onwards. Cost Explorer: no data yet (new account) |

## End to end — reader speaks a word → the TV lights it (real loop, AWS)
| | |
|---|---|
| Measurement | TV `word-lit` time − word spoken time (the recogniser's word start, mapped through the phone's capture clock) |
| Path | Phone browser mic → WSS → EC2 t4g.micro (ap-south-1, Caddy TLS) → Amazon Transcribe Streaming → reading engine → WSS → Vega Virtual Device. Echo Mode, Transcribe stability high |
| Reader | ONE ADULT (the developer), English, Busy Ants, 4 turns, 2026-10-08. Not a child |
| Method | `tools/e2e/word-lit-latency.ts` on the session's traces and the TV's word-lit telemetry (`docs/results/e2e/real-20261008T182033Z.json`) |
| Result | **8 words lit: e2e median 1 089 ms, p95 1 156 ms; 1 of 8 within 1 s.** Recognition (spoken → server emits) median 1 046 ms; server → TV median 28 ms (p95 111 ms). In the same turns, 11 words were helped after a 3 s stall and 1 skipped (see the note) |
| Status | **MEASURED, very small sample (n = 8), one adult.** Against the ≤ 1 s median target: **not met** (1.09 s). Almost all of the delay is speech recognition, as S2 predicted; network and TV add ≈ 30–110 ms |
| Note | Many words were helped. Production traces keep no transcript text (privacy), so whether those words weren't spoken (the tester was testing stalls) or weren't recognised is **UNKNOWN** from the logs alone |

## Privacy audit — real loop on AWS
| | |
|---|---|
| Result | Session N25T (adult tester): **249 microphone status reports from the phone, 0 violations** (mic live only during turns; 55 live-in-turn, 6 off-in-turn reports while turns were starting). Mic off **11–67 ms** after each of the 4 turn ends. Audio path: phone → AWS HTTPS endpoint only (no dev tunnel; checked by the health check). `docs/results/privacy/aws-20261008T182033Z.json` |
| Status | **MEASURED** (one session, one adult) |

## Help timing — recovery after a help word (real recogniser, synthetic reader)
| | |
|---|---|
| Measurement | After the TV helps with a stuck word: is the NEXT word read, or helped too early? Recovery time = help word ends → next word lit |
| Method | `tools/s2/help-recovery.ts`: 10 turn lines from the shipped stories (en 6, hi 4) × reading pace after the helped word (600 / 1500 ms) × driver before / after the 2026-10-09 fix. Reader = Polly Kajal (adult synthetic) → Amazon Transcribe Streaming (ap-south-1) → production hub/driver/engine. The reader reacts to the TV: hesitates (“um… um…” / “अ… अ…”), goes quiet, waits for the help word (start latency 300 ms, leaking into the mic at 30 % — INFERRED constants), repeats it 500 ms later, then reads on. `docs/results/help/recovery-2026-10-09T11-47/` |
| Result | **Next word helped too early: before 1 / 20, after 0 / 20** (the early help was a Hindi line at the slow pace: जाना helped while the reader was still repeating मत). Next word read: 19 / 20 in both (the other “after” case: की was skipped by recognition, not by the timer). Lines completed 20 / 20 in both. Recovery median 3.56 s before, 3.37 s after; help came ≈ 3.6 s after the hesitation ended in both |
| Status | **MEASURED, small sample, adult synthetic voice.** The synthetic reader reproduces the reported problem only at the slow pace; the fix removed it there and changed nothing else. A child's timing is UNKNOWN. The real-device check (phase B) is still to run |

## Second real loop on AWS (2026-10-09, after the help-timing fix)
| | |
|---|---|
| Path / reader | Same as the first loop (phone → EC2 → Transcribe → Vega Virtual Device, Echo Mode). ONE ADULT, English, Busy Ants, 4 turns, deliberate stutters |
| Word lit after spoken | **13 words: e2e median 1 186 ms, p95 1 578 ms; 2 of 13 within 1 s.** Recognition median 1 060 ms; server → TV median 60 ms. `docs/results/e2e/real-20261009T120230Z.json` |
| Help word on the TV | From the help event to the TV reporting the help clip finished: **1.24–1.50 s (n = 7, median 1.37 s)** — clip start on the VVD + the slow (80 %) word. The child's time now starts after this |
| Stutter handling | While the tester stuttered, help waited for the sound to stop (or for the 8 s cap — since lowered to 6 s at the tester's request) |
| Privacy audit | **175 microphone status reports, 0 violations**; mic off 44–83 ms after each turn end. `docs/results/privacy/` |
| Status | **MEASURED, one adult, n small.** Tester feedback from this run: after a help the line moved straight on, without a chance to say the helped word → “say it back” added (below) |

## Deployment checks (2026-10-09)
- **Certificate reuse:** a redeploy kept the same certificate (serial `…5F309FAAF5`, issued 2026-10-08) — no new Let's Encrypt issuance. `docs/results/deploy/cert-reuse-20261009T115329Z.txt`
- **Start-up:** EC2 refused to start the stopped t4g.micro (`InsufficientInstanceCapacity`, W15); the start script switched it to **t4g.small** (same image), which started.
