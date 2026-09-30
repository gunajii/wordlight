# Go/no-go spikes (gate: 2026-10-02)

Labels: **MEASURED** (read from instrumentation) · **INFERRED** · **HYPOTHESIZED** · **UNKNOWN**.

| Spike | Question | Pass bar | Result | Fallback |
|---|---|---|---|---|
| S1 Vega basics | Can a Vega app play narration, report time, render Devanagari, handle the D-pad? | median offset ≤ 100 ms; stable over 3 min; conjuncts/matras correct | **PASS on the Virtual Device (2026-09-30)** with a per-platform lead: calibrated M4A median **−1.0 ms** (stdev 11.2) · stable **PASS** · Devanagari **PASS** (system font) · D-pad **PASS**. Uncalibrated: −392 ms (MP3), −339 ms (M4A). **Fire TV hardware UNKNOWN.** | Fire OS (React Native TV) build |
| S2 Child speech | Can Transcribe + matcher follow a child reading hi/en? | ≥ 90 % correct words lit within 1.0 s; ≤ 10 % misreads accepted | **UNKNOWN** — matcher built; no speech tested | Echo mode; browser speech recognition |
| S3 Phone mic | Do iOS Safari and Android Chrome stream mic audio reliably over HTTPS? | both work; mic → server ≤ 300 ms; no drops in 10 min | **UNKNOWN on real phones** — pipeline built and validated in headless Chromium with a fake microphone (see S3 below); iPhone/Android runs pending | demo on the browser that passes; document the gap |
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

## S1 — results, run 2: calibration check + recording-chain check (2026-09-30)

Same setup as run 1 (full-screen macOS screen recording, 3024×1964, VFR ≈ 9.4 fps; MacBook mic), started with `tools/s1-run/s1-run.sh` (no manual steps).

| | `cal-m4a`: M4A, `leadMs = −339` | `chain`: chain-check.mp4 in QuickTime (no Vega) |
|---|---|---|
| pairs | 242 (recording stopped 11 words early; 177.5 s span) | 94 / 95 |
| **median offset** | **−1.0 ms** | **−28.4 ms** |
| stdev · range | 11.2 ms · −32.1 … +31.3 | 7.3 ms · −37.6 … +1.7 |
| first- vs last-minute median | +0.1 vs −2.2 ms | −28.6 vs −28.2 ms |
| drift | −0.83 ms/min | +0.16 ms/min |
| S1 bars | median ≤ 100 ms **PASS** · stable **PASS** | n/a |

All MEASURED. Conclusions:
- **The lead mechanism works as designed:** with a lead equal to the measured offset, the residual is −1.0 ms, and the spread (11 ms) is unchanged from the uncalibrated run. S1's timing criteria pass **on the VVD, with calibration**.
- **Recording chain:** a file whose flash and click are in sync by construction reads −28 ms through QuickTime → speakers → screen recording + mic. So about 28 ms of the −339 ms is INFERRED to come from the measurement setup (QuickTime's own A/V sync is part of that chain and not separated). The rest, ≈ −311 ms, is the VVD + Mac audio path. Viewer-perceived offset on the VVD after calibration is therefore INFERRED ≈ +27 ms (words light ≈ 27 ms after the sound). That is well inside the bar either way.
- **Not transferable:** a Fire TV device has a different audio path; the lead must be measured per device type. Real hardware remains UNKNOWN.

## S1 — one-command runs (added 2026-09-30)

After run 1, each further S1 measurement is one command on the Mac, with no rebuild and no remote presses:
`bash tools/s1-run/s1-run.sh <label> --audio p1.m4a --lead -339` records the screen and microphone with `screencapture -v -g`, captures the TV log, and starts the run. The run is started through `.dev/tv.json` → `/api/config`: the open TV app polls it every 2 s and plays from 0 with the given audio file and lead. `--chain` records `recordings/chain-check.mp4` (flash and click in sync by construction) played in QuickTime, to measure the Mac's own recording chain.

## S1 — runbook (Mac)

See the "Next" section of the latest report, or `apps/vega-tv/setup.sh` output.

---

## S3 — phone microphone: design and method (2026-09-30)

**Question.** Can a real iPhone (Safari) and a real Android phone (Chrome) capture microphone audio and stream it reliably to the WordLight server during a reading turn, with first-sample → server latency ≤ 300 ms, no unexplained loss over 10 minutes, over HTTPS — and is the microphone provably off outside turns?

**Scope.** Capture + transport + measurement only. No Transcribe, no reading engine (those are S2). The server's turn driver is a measurement sink (`server/src/s3/sink.ts`) standing exactly where the Transcribe adapter will stand (`TurnDriver`), so S2 replaces the sink, not the phone audio stack.

### HTTPS for phones — decision
| Option | Works on iOS Safari + Android Chrome? | Setup on each phone | Where audio travels | Chosen |
|---|---|---|---|---|
| **Cloudflare quick tunnel** (`tools/dev-tunnel/dev-tunnel.sh`, already used for Vega media) | yes: publicly trusted certificate (INFERRED from TLS; to be confirmed by the runs) | none | phone → internet → Cloudflare → Mac | **yes, for S3** |
| mkcert local CA on the Mac | needs the root CA installed *and trusted* on every phone; plus a hostname that survives DHCP changes (LAN IP changed 3× in two days) | several manual steps per phone | LAN only | documented alternative, UNTESTED |
| plain http on LAN | **no**: `getUserMedia` requires a secure context | — | — | no |

Why the tunnel: zero phone setup, reproducible (script), and its path (phone → internet → server) resembles production (phone → internet → AWS) more than a LAN does, so its latency is the more honest number. Cost: **audio crosses Cloudflare's network**, so it is used with synthetic tones and adult test speech only (docs/PRIVACY.md). It is not local-only and is not described as such.

### Audio format
| | |
|---|---|
| Source | `getUserMedia({audio:{channelCount:1, echoCancellation, noiseSuppression, autoGainControl: true}})` → `MediaStreamAudioSourceNode` in the page's `AudioContext` at the **device rate** (not assumed; the page reports `ctxRate` and the track's `getSettings()` in `mic.state` `open`) |
| Processing | AudioWorklet `web/phone/mic-worklet.js`: stereo→mono average; windowed-sinc low-pass (7.2 kHz, Hann) + fractional decimation to 16 kHz; group delay ≤ 0.7 ms; unit-tested at 48 000 / 44 100 / 16 000 Hz in (1 kHz and 6 kHz kept within 2 %, 12 kHz suppressed — no aliasing) |
| Output | PCM16 signed, mono, **16 000 Hz** (what Transcribe Streaming accepts for hi-IN/en-IN) |
| Chunk | 20 / 40 / 60 / 100 ms = 320 / 640 / 960 / 1600 samples = 640 / 1280 / 1920 / 3200 bytes + 16-byte header |

### Chunk protocol (binary WebSocket message, `packages/shared-protocol/src/audio.ts`)
`u8 version=1 · u8 flags(bit0 last) · u16 tag · u32 seq · f64 capturedAtMs · PCM16…`
- **tag**: server-assigned per turn in `turn.start.audioTag`; the server drops frames whose tag is not the active turn's (counted as `staleTag`), so frames of an ended turn can never count in the next one.
- **seq**: 0,1,2… per turn → server counts **missing** (never arrived), **duplicates**, **out-of-order**.
- **capturedAtMs**: phone clock (`performance.now()`) of the chunk's first sample. Never treated as a server time.
- sessionId/readerId are not repeated per chunk: the socket is already bound to the session and phone by `hello`, and the turn by `tag`. sampleCount = (bytes − 16)/2.
- PCM is never logged, stored or written to telemetry; the server keeps per-turn **numbers** only (`bench/runs/s3/<session>/<turn>.json`, gitignored).

### Latency — what exactly is measured
```
first-sample latency = serverRecvMs − (capturedAtMs + clockOffsetMs)
capturedAtMs        = phone performance.now() when the worklet chunk reaches the page − chunk duration
clockOffsetMs       = phone's NTP-style estimate (server ≈ phone + offset; lowest-RTT samples, drift fit;
                      Earshot's ClockSync), reported every 2 s; uncertainty ≈ ± minRtt/2
transport latency   = first-sample latency − chunk duration
```
Included: chunk buffering, resampling, worklet → page, WebSocket send, network (incl. tunnel), server receipt. **Not included:** microphone hardware + OS input buffering before the AudioWorklet sees the samples — JavaScript cannot observe it. To bound the true total, the runner plays a **1 kHz test tone** on the Mac (`afplay`) during turns; the server finds its onsets in the stream (onset times only), giving **afplay start → server receipt**, an **upper bound** of the true acoustic latency (it also contains afplay start-up and Mac output latency).

### Privacy mechanisms (what enforces "mic only during a turn")
- The page never calls `getUserMedia` on load, consent or "Get ready"; only on a server `turn.start`, and only after consent was given on that phone.
- Every end path stops every track (`MediaStreamTrack.stop()`): `turn.cancel`, `line.done`, socket lost, page hidden, page unload, a replaced turn, and a turn that ends while the permission prompt is still open.
- **Audit from the browser API, not the UI:** every second the page reports how many of its microphone tracks have `readyState === 'live'`; the server records a **violation** if a phone reports a live track outside its turn for longer than 2 s.
- The server caps every turn (TV turns 90 s, test turns 11 min): a turn nobody ends still closes the microphone.
- A phone that reconnects during its turn gets that turn **ended** (`phone-lost`); nothing resumes blindly, and the new socket's frames cannot carry the old tag.
- iOS/Chrome autoplay rules: audio processing needs one tap per page load ("Get ready", mic stays off). A turn arriving before that tap shows "Tap to start listening" (reported as `mic.state opening needs-tap`).

### How to run (Mac)
```
npm start                                   # terminal 1
bash tools/dev-tunnel/dev-tunnel.sh         # terminal 2 (https for phones)
npm run s3 -- --label iphone                # terminal 3: QR + link, then runs everything
```
Plan `full` (default, ≈ 17 min): 8 s idle privacy check → 4 × 60 s turns at 20/40/60/100 ms chunks with test tones → skip check → 10-min endurance turn. `--plan network` = 3-min turn for the Wi-Fi-off test; `--plan quick` = 30 s smoke test. Report: `bench/runs/s3/<SESSION>/report-<label>-<plan>.json`.

### Results so far
**Pipeline validation — headless Chromium (Linux) with Chromium's fake microphone, server on localhost (MEASURED 2026-09-30; not a phone, no network):**

| Check | Result |
|---|---|
| page load / consent / "Get ready" | no `getUserMedia` call; mic tracks live 0; 0 violations over 8 s idle |
| turn 20 ms chunks (6 s) | 228 frames, missing 0, dup 0, out-of-order 0, stale 0; first-sample latency median 20.5 ms (p95 21.2, max 24.2) → transport ≈ 0.5 ms; context rate 44 100 → 16 000 Hz; first turn's first frame 1446 ms after start (first `getUserMedia` + worklet start) |
| turn 100 ms chunks (6 s) | 59 frames, 0 missing; median 100.7 ms; effective sample rate 15 973 Hz; first frame 106 ms after start |
| turn end / skip / page hidden mid-turn | mic OFF, live tracks 0 (browser API) |
| reload mid-turn | server ended the turn (`phone-lost`); new page made 0 `getUserMedia` calls; next turn waited for a tap (`needs-tap`) |
| privacy audit over the run | 56 status reports, 0 violations |
| synthetic phone (`tools/s3/fake-phone.ts`, Node) | click detector found each 1 kHz tone; sequence and latency accounting match the injected jitter |

**Real phones:** iPhone Safari UNKNOWN · Android Chrome UNKNOWN · 10-minute run UNKNOWN · Wi-Fi interruption UNKNOWN · background/foreground on iOS UNKNOWN · acoustic upper bound UNKNOWN.
