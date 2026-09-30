# Go/no-go spikes (gate: 2026-10-02)

Labels: **MEASURED** (read from instrumentation) · **INFERRED** · **HYPOTHESIZED** · **UNKNOWN**.

| Spike | Question | Pass bar | Result | Fallback |
|---|---|---|---|---|
| S1 Vega basics | Can a Vega app play narration, report time, render Devanagari, handle the D-pad? | median offset ≤ 100 ms; stable over 3 min; conjuncts/matras correct | **VVD run 1 (2026-09-30):** uncalibrated offset **FAIL** (−392 ms MP3, −339 ms M4A: words light up *before* they are heard) · stable **PASS** · Devanagari **PASS** (system font) · D-pad **PASS**. Constant offset → calibration run pending. Real hardware UNKNOWN. | Fire OS (React Native TV) build |
| S2 Child speech | Can Transcribe + matcher follow a child reading hi/en? | ≥ 90 % correct words lit within 1.0 s; ≤ 10 % misreads accepted | **UNKNOWN** — matcher built; no speech tested | Echo mode; browser speech recognition |
| S3 Phone mic | Do iOS Safari and Android Chrome stream mic audio reliably over HTTPS? | both work; mic → server ≤ 300 ms; no drops in 10 min | **UNKNOWN** — not started | demo on the browser that passes; document the gap |
| S4 Polly timings | Do Kajal speech marks match the audio? | ≥ 95 % of words within 50 ms of onset | **UNKNOWN** — mapping built; no AWS access yet | Transcribe word timestamps |

## S1 — method

**Test content** (`npm run s1:media`, already generated): 52 lines / 253 words over 189 s, English and Hindi including conjuncts. Instead of speech, each word is a 25 ms 1 kHz click exactly at its `t0`, so the truth is known by construction. The audio is provided as MP3 and M4A (AAC); both formats carry encoder delay that a decoder may or may not compensate, so each is measured. Offline check (ffmpeg decode): click onsets within 0.3 ms of `t0` in both formats — **MEASURED** (offline only).

**App**: `apps/vega-tv` S1 build. W3C `AudioPlayer` (usage pattern from Amazon's vega-audio-sample), `currentTime` polled every 20 ms through `PlayheadSampler`, words lit by `karaoke-core`. A white 160×160 marker flashes for 100 ms whenever the lit word changes. Diagnostics on screen and in logs: `currentTime` update period, poll-loop gaps.

**Measurement**: film the screen and sound (phone, 60 fps), then `python3 tools/audio-analysis/av_offset.py recording.mov`. offset = flash − click (positive = word lights after it is heard). Stable = first-minute and last-minute medians within 20 ms (our operational definition of "stable over 3 minutes").

**Tool validation (MEASURED, synthetic recordings with known offsets, AAC audio + pink noise):**

| True offset | fps | Measured median | stdev |
|---|---|---|---|
| +60 ms | 30 | +57.7 ms | 13.2 |
| −40 ms | 60 | −41.5 ms | 9.7 |
| +120 ms | 30 | +117.3 ms (correctly FAIL) | 13.4 |
| +20 ms, drift 15 ms/min | 30 | drift 14.35 ms/min detected (correctly FAIL stability) | 18.6 |

Stdev is dominated by the synthetic 10 ms jitter and frame quantisation. Median bias −2 to −3 ms.

**Variable-frame-rate recordings (macOS screen recording emits frames only on change).** Simulated by dropping unchanged frames (`ffmpeg -vf mpdecimate -vsync vfr`) from a +60 ms / 60 fps synthetic: 11 100 → 497 frames. Before the fix the analyzer reported **−160.1 ms** (it put each flash at the midpoint of a long frame gap). After the fix (first bright frame's own timestamp when the gap > 1.5 × median frame interval): **+66.9 ms** (stdev 12.7), constant-rate file unchanged at +58.5 ms. So a VFR screen recording reads ≈ +7 ms late (at most one frame) — MEASURED on synthetic data, 2026-09-30.

**Screen recording vs filming.** A macOS screen recording timestamps the frame when the Mac composites it; filming the panel adds the display's own latency. On the VVD the app under test is the same either way, so the screen recording isolates the app's timing; filming answers "what a viewer sees". Results are labelled with the method used.

**What S1 on the Virtual Device does NOT tell us:** physical Fire TV output latency, HDMI/TV audio path, or real speech. Those are Test 10 / S4.

## S1 — results, Vega Virtual Device run 1 (2026-09-30)

Setup: VVD (SDK 0.24.12112, w3cmedia 2.3.2) on MacBook Pro (arm64, macOS 26.3.1); sound through the Mac speakers; **macOS screen recording** (full screen, 3024×1446, variable frame rate ≈ 10 fps) with the MacBook microphone picking up the clicks; `LEAD_MS = 0`; media over HTTPS (dev tunnel). Analyzer: `av_offset.py` with marker auto-crop and global-offset pairing (both added after nearest-click pairing gave garbage at this offset; validated on synthetic +60 ms → 58.5 ms and −390 ms → −391.4 ms).

| | MP3 (`p1.mp3`) | M4A (`p1.m4a`) |
|---|---|---|
| pairs | 253 / 253 words | 253 / 253 words |
| **median offset (flash − click)** | **−392.0 ms** | **−339.2 ms** |
| stdev · range | 11.1 ms · −423.9 … −358.7 | 13.3 ms · −380.1 … −306.0 |
| first-minute vs last-minute median | −390.6 vs −394.4 ms | −339.5 vs −337.4 ms |
| drift | −1.85 ms/min | −1.12 ms/min |
| S1 bar: median ≤ 100 ms | **FAIL** | **FAIL** |
| S1 bar: stable over 3 min | **PASS** | **PASS** |

All MEASURED. Other measurements from the M4A run log: `currentTime` changed on **every** 20 ms poll (update period ≤ 20 ms, limited by our poll rate) · poll-loop gap median 20.0 ms, max 22.7–24.6 ms per 1-s window · no stalls or media errors during playback.

Interpretation:
- Negative = the highlight is **ahead** of the sound. The offset is large but constant (stdev 11–13 ms, drift < 2 ms/min), which is the correctable case: `LEAD_MS` shifts the highlight; with LEAD_MS ≈ −390 (MP3) / −340 (M4A) the residual should be ≈ 0 ± 13 ms. **HYPOTHESIZED until the calibration run confirms it.**
- The offset is the sum of (a) VVD emulator audio buffering, (b) macOS audio output, (c) the screen recording's own mic-vs-video alignment, (d) any decoder priming the player does not trim. We have **not** separated these. (a)–(c) are specific to this Mac/emulator setup, so **these numbers do not transfer to Fire TV hardware** — real-device offset is UNKNOWN.
- MP3 is 53 ms further ahead than M4A. INFERRED cause: encoder-delay/priming handling differs by codec in the Vega pipeline; the offline decode check shows ffmpeg trims both to < 0.3 ms, so the difference comes from the device side. Consequence: calibrate **per audio format**; ship one format.
- Product consequence: a fixed per-platform lead is needed and must be measured on each target (VVD, each Fire TV model); consider a one-time "sync check" if hardware varies. Not built.

## S1 — one-command runs (added 2026-09-30)

After run 1, each further S1 measurement is one command on the Mac, with no rebuild and no remote presses:
`bash tools/s1-run/s1-run.sh <label> --audio p1.m4a --lead -339` records the screen and microphone with `screencapture -v -g`, captures the TV log, and starts the run. The run is started through `.dev/tv.json` → `/api/config`: the open TV app polls it every 2 s and plays from 0 with the given audio file and lead. `--chain` records `recordings/chain-check.mp4` (flash and click in sync by construction) played in QuickTime, to measure the Mac's own recording chain.

## S1 — runbook (Mac)

See the "Next" section of the latest report, or `apps/vega-tv/setup.sh` output.
