# Go/no-go spikes (gate: 2026-10-02)

Labels: **MEASURED** (read from instrumentation) · **INFERRED** · **HYPOTHESIZED** · **UNKNOWN**.

| Spike | Question | Pass bar | Result | Fallback |
|---|---|---|---|---|
| S1 Vega basics | Can a Vega app play narration, report time, render Devanagari, handle the D-pad? | median offset ≤ 100 ms; stable over 3 min; conjuncts/matras correct | **PASS on the Virtual Device (2026-09-30)** with a per-platform lead: calibrated M4A median **−1.0 ms** (stdev 11.2) · stable **PASS** · Devanagari **PASS** (system font) · D-pad **PASS**. Uncalibrated: −392 ms (MP3), −339 ms (M4A). **Fire TV hardware UNKNOWN.** | Fire OS (React Native TV) build |
| S2 Child speech | Can Transcribe + matcher follow a child reading hi/en? | ≥ 90 % correct words lit within 1.0 s; ≤ 10 % misreads accepted | **UNKNOWN** — pipeline built and tested with fakes (Transcribe adapter, reading driver, harness); waiting for AWS credentials to run `tools/s2/run-synth.ts` | Echo mode; browser speech recognition |
| S3 Phone mic | Do iOS Safari and Android Chrome stream mic audio reliably over HTTPS? | both work; mic → server ≤ 300 ms; no drops in 10 min | **PASS (tested conditions), 2026-10-05:** iPhone Safari + Android Chrome; ≈ 52 000 chunks, 0 lost/duplicated/out of order; median 50–90 ms; correct mic lifecycle under Wi-Fi loss, lock, app switch, reload (Android); 0 privacy violations. Open: iPhone reload, untouched 10-min run with wake lock, run-1 Android reconnect cause | demo on the browser that passes; document the gap |
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

### Real-phone run 1 (2026-09-30, `npm run s3`, plan `full`) — MEASURED unless marked

Environment: phones on the home Wi-Fi, server on the MacBook Pro, **phone → Cloudflare quick tunnel → Mac** (HTTPS/WSS). Test tones from the Mac speakers (`afplay`); no voice. Sessions: iPhone `7PGN`, Android `P33V`. An earlier Android run (`PHC3`) was aborted by the tester and is excluded from the verdict (its facts are listed below).

**Sequence integrity — both phones:** iPhone 20 990 chunks, Android 20 969 chunks: **0 missing, 0 duplicate, 0 out-of-order, 0 stale-tag**.

| | iPhone Safari | Android Chrome |
|---|---|---|
| chunk-size sweep, first-sample → server, **median / p95 / max** (ms) | 20 ms: 29.8 / 50.5 / 141.5 · **40 ms: 49.5 / 70.3 / 212.7** · 60 ms: 71.6 / 165.8 / 412 · 100 ms: 127.5 / 218.2 / 726.9 | 20 ms: 31.4 / 55.1 / 444.3 · **40 ms: 52.1 / 90.8 / 438.2** · 60 ms: 84.6 / 163.1 / 384.5 · 100 ms: 130.8 / 231 / 449.3 |
| transport only (first-sample − chunk), median / p95 (ms) | 20: 9.8 / 30.5 · 40: 9.5 / 30.3 · 60: 11.6 / 105.8 · 100: 27.5 / 118.2 | 20: 11.4 / 35.1 · 40: 12.1 / 50.8 · 60: 24.6 / 103.1 · 100: 30.8 / 131 |
| **10-min endurance, 40 ms** | one 600 s turn: 14 990 chunks, 0 loss; median **49.8**, p95 74.5, max 1257.6 ms | 244 s + 354 s (the first turn ended `phone-lost` at 244 s; cause UNKNOWN, see below): 14 876 chunks, 0 loss; median **51.7 / 51.9**, p95 74.2 / 84.1, max 700.9 / 819.5 ms |
| clock sync (phone ↔ server via tunnel) | min RTT 12–15 ms → offset uncertainty ≈ ±7 ms | min RTT 15–17 ms → ≈ ±8 ms |
| audio coverage (audio received ÷ time since first chunk) | 0.998–1.002 | 0.992–0.998 (effective rate ≈ 15 950 Hz) |
| first chunk after turn start | 2755 ms on the first turn (permission prompt), then 404–658 ms | 289–770 ms (permission already granted in the aborted run) |
| acoustic: afplay start → server, **median** (40 ms chunks) | 306 ms (sweep), 306 ms (endurance) | 340 ms (sweep), 334–337 ms (endurance) |
| acoustic: afplay start → captured (phone clock → server clock), median | 266–268 ms, very stable | 287–292 ms, very stable |
| privacy audit (live mic tracks, browser API, 1/s) | 897 reports, **0 violations**; idle 8 s: mic live 0 | 880 reports, **0 violations**; idle 8 s: mic live 0 |
| mic off after turn end / skip | ≤ 1 s everywhere (the measurement had 1-s resolution; fixed for the next run) | ≤ 1 s everywhere |

Interpretation:
- **Latency bar (≤ 300 ms, first sample → server): PASS on both phones at every chunk size by median**, and by p95 at 20/40 ms. What is not covered by this number is the phone's microphone hardware/OS input delay (not observable from JavaScript).
- **Acoustic upper bound does not yet close the question.** afplay start → server is 306 ms (iPhone) / 340 ms (Android), but ≈ 260–290 ms of that is afplay start-up + Mac audio output + the phone's input delay, which are not separated. The spawn → capture part is nearly constant (spread of a few ms), so it is a fixed pipeline delay, not network. The Android − iPhone difference (≈ 23 ms) is INFERRED to be the difference in phone input delay (same Mac, same tones). **Next: measure the Mac-side part** by running the same test with the page open on the Mac itself (its mic hears afplay directly).
- **Chunk size:** transport p95 jumps at 60/100 ms on both phones (≈ 30–50 → 103–131 ms). INFERRED cause: with fewer packets the Wi-Fi radio enters power save between sends. **Choice: 40 ms** — median ≈ 50 ms, p95 70–91 ms, 25 messages/s; 20 ms saves ≈ 20 ms of buffering for twice the messages. The server can re-chunk for Transcribe (S2).
- **Android delivers ≈ 0.3 % less audio than wall-clock time** (coverage 0.997, effective rate ≈ 15 950 Hz) with **no sequence gaps**. INFERRED: a clock-rate difference (Android audio clock vs system clock), not dropouts. Harmless for recognition. The next run records timeline drift to distinguish a steady clock difference from steps (loss).
- **Outliers:** single-chunk maxima of 0.4–1.3 s on both phones (Wi-Fi). They are rare (p95 ≤ 91 ms at 40 ms chunks) and caused no loss.
- **Android endurance `phone-lost` at 244 s:** the socket was replaced mid-turn, the server ended the turn as designed, the runner started a new turn, and the remaining 354 s ran clean. Cause (screen timeout, app switch, network) UNKNOWN — the tester is asked; the next run saves the session timeline.
- Aborted Android run `PHC3`: the tester reports the **screen locked**. Turn 1 delivered 68 % of its audio; turns 2–3 delivered no audio (the second ended `phone-lost`). This is consistent with a locked screen stopping the page, INFERRED. Not used for the verdict. Product consequence: the phone must stay awake during a session (Screen Wake Lock API or a user setting). Whether that works on iOS/Android is UNKNOWN; not built.
- **Metric fix:** the first version's "capture gaps" counted chunks reaching the page in bursts (Android: 293 per minute) even when no audio was lost (coverage 0.997, no sequence gaps). It is now documented as delivery irregularity. Coverage and timeline drift are the loss metrics.

Still UNKNOWN: Wi-Fi interruption, lock screen/background, reload on real phones · Mac-side part of the acoustic bound · phone input delay · audio device sample rates (in the saved timeline from the next run).

### Real-phone run 2 — interruptions (2026-10-05, `--plan network`, sessions iPhone `8PTM`, Android `TRS5`) — MEASURED from the saved timelines (phone events + server events)

Devices (from `mic.state open`): **iPhone**, Safari (UA "iPhone OS 18_7 … Version/26.6.1"), AudioContext 48 000 Hz, track 48 000 Hz, echo cancellation on. **Android 10**, Chrome 154, 48 000 Hz, mono track, EC/NS/AGC on, reported track latency 10 ms, AudioContext baseLatency 4 ms. Both: Screen Wake Lock API present.

| Event during a turn | iPhone Safari | Android Chrome |
|---|---|---|
| **Wi-Fi off** | socket closed (1006) → **mic stopped at once** (`connection-lost`); browser `offline` 2.1 s later; server ended the turn at its 5 s heartbeat (`phone-lost`); phone reconnected when Wi-Fi returned (≈13 s); **new turn needed, nothing resumed** | socket closed (1006) → **mic stopped at once**; Android **switched to mobile data** and reconnected in 3.6 s → server ended the old turn on rejoin; the runner's next turn ran on cellular until Wi-Fi came back, then that socket dropped too and the turn ended the same way. Never resumed |
| **Screen locked** (power button) | AudioContext → `interrupted`, mic stopped (`audio-suspended`), page hidden, wake lock released by the browser; server ended the turn **at once** (phone's `mic.state closed`); socket survived 11 s; on unlock: wake lock re-acquired, audio `running`, new turn opened the mic in 0.4 s | page hidden → mic stopped (`page-hidden`), wake lock released; server ended the turn at once; socket survived; on unlock: wake lock back, new turn |
| **App switch** | same as lock (`interrupted` → stop); iOS **closed the socket while in the background** (server saw it ≈14 s later); on return: reconnect in 1.2 s, new turn | same as lock; socket survived |
| **Reload** | **not performed in this run** | `pagehide` → mic stopped (`page-unload`), socket closed cleanly (1001); after reload the page asked for the tap again (`needs-tap`), no mic until then; consent remembered |
| chunk loss / order | 4 739 chunks: 0 missing, 0 duplicate, 0 out-of-order; **1 stale-tag chunk dropped** (a chunk of an ended turn arriving after the next turn started — the tag check working) | 5 062 chunks: 0 missing, 0 duplicate, 0 out-of-order, 0 stale |
| latency (40 ms chunks), per-turn medians | 58–73 ms; p95 82–183 ms | 67–92 ms; p95 100–208 ms (incl. a turn on mobile data) |
| privacy audit | 254 reports, **0 violations** | 274 reports, **0 violations** |
| mic off after the server ended a turn | 2–44 ms, except the Wi-Fi case: the phone had stopped the mic 5 s **before** the server's end, but its report could only arrive after reconnecting (8.1 s) — not a live mic | 1–89 ms |

Findings and fixes:
- **The lifecycle rules held on both phones under every interruption tested:** the mic stopped at the interruption itself (not later), the server never continued a turn whose phone had gone, and no turn resumed by itself.
- **Measurement bug found and fixed:** after the Android reload, one chunk showed 168 s "latency". The server kept the old page's clock estimate (a reloaded page restarts `performance.now()`). The server now drops a phone's clock estimate on every new socket (test added). That turn's max is invalid; its median (70.6 ms) and p95 (131.8 ms) were not affected.
- **Test-procedure issue fixed:** on the iPhone, the page's manual "Start reading turn" button was tapped during the run; its turns collided with the runner's (turns 1–2 ended `error`). Those buttons now appear only with `?manual=1`.
- **Android falls back to mobile data when Wi-Fi drops**, and the stream continued over it after a new turn. For the product: still TLS end to end, but data use and latency change; the TV should say so if it matters. INFERRED.
- Timeline drift on Android varied (−124 … +414 ms per turn) while coverage stayed 0.99–1.01. The drift metric is sensitive to Android's bursty delivery at turn start, so it is not used as evidence of loss. INFERRED.

### S3 verdict (2026-10-05)
**PASS for the tested conditions on iPhone Safari (iOS, Safari 26.6) and Android Chrome 154 (Android 10):**
- ≈ 52 000 chunks over four runs with **0 lost, 0 duplicated, 0 out of order**
- capture→server **median 50–90 ms** (≤ 300 ms target), p95 ≤ 210 ms
- 10-minute run clean on iPhone; on Android, 598 s with 0 loss but one reconnect
- correct microphone lifecycle under Wi-Fi loss, lock, app switch and (Android) reload
- 0 privacy violations

Still open, and not hidden by this verdict:
1. iPhone reload — not yet run.
2. Whether the wake lock actually stops auto-lock during an untouched 10-minute session — UNKNOWN; the API reported `on` on both phones.
3. The cause of the single Android reconnect in run 1 — UNKNOWN; not reproduced.
4. The Mac-side part of the acoustic bound — UNKNOWN.

Production child audio will use the AWS endpoint, not this tunnel; S3 re-checks latency there.

---

## S2 — speech recognition: what exists (2026-10-05), not yet measured
- `server/src/reading/speech.ts` **TranscribeSource**: Amazon Transcribe Streaming, 16 kHz PCM, partial results with stabilisation (`high`; retried without it if a language rejects it), word start/end times, error → turn ends `error`. `SimSource`: DEV ONLY timer reader, logged as such, never used for measurement.
- `server/src/reading/driver.ts` **ReadingDriver**: wraps the unchanged reading engine; the engine clock starts at the first audio chunk (mic start-up is not a stall); help after 3 s (5 s before the first word); per-word trace (spoken time from Transcribe's word start via the phone's capture clock, update arrival, emit time).
- `tools/s2/run-synth.ts` **harness**: 20 original lines (10 en-IN, 10 hi-IN) × variants correct / misread / omit / repeat / hesitate 1.2 s / pause 4.5 s, spoken by Polly and streamed in real time through the real pipeline. Exact ground truth from speech marks. Reports recall@1s, false-accept rate, latency (median/p95/max) per language and variant. Synthetic adult voices: characterises the pipeline, **not child reading** (child performance stays UNKNOWN unless tested with consent).
- Verified so far only with fakes (unit tests) and the dev simulator through a real phone page (headless Chromium): TV gets mic.state → word.read ×4 → word.helped (stall 3.06 s) → line.done; phone mic off after line.done; template summary on phone and TV.
