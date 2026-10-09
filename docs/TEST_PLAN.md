# Test plan

## Environment (2026-09-29) — MEASURED

| Item | Value |
|---|---|
| Mac | arm64, macOS 26.3.1 (25D2128), 926 GB disk, 739 GB free |
| Node / npm | v25.8.1 / 11.11.0 |
| Python | 3.9.6 (numpy 2.0.2) |
| git | 2.50.1 |
| Homebrew | /opt/homebrew |
| Vega | SDK 0.24.12112, CLI 1.4.2, Virtual Device installed with the SDK; Vega Studio extension installed |
| AWS CLI | not installed |
| ffmpeg on Mac | not installed (media generation and analysis run in Claude's Linux workspace) |

## Automated tests

`npm test`: **197 tests pass** (2026-10-09; 165 on 2026-10-05). `npm run typecheck` is clean, and the Vega app passes its own
`tsc --noEmit` after `sync.sh`.

| Suite | Tests |
|---|---|
| reading engine | 25 |
| karaoke-vega (open source) | 11 |
| story package | 8 |
| protocol | 4 |
| session client (reused) | 7 |
| TV core | 8 |
| server | 64 |
| phone | 38 |

Server tests cover: hub, S3, reading driver, scripted simulation, S2 harness, S4 analysis, content, summary, config
and the local demo loop. Phone tests cover: lifecycle, the privacy invariant table, the resampler and the wake lock.

| Area | Covered |
|---|---|
| Reading engine | exact, punctuation, Hindi normalisation, NFC/NFD, partial transcripts, fuzzy (ASR noise), misreads (cat/hat, big/bag, lived/loved, कल/काल, बिल्ली/बल्ली, किताबें/किताबों), skipped, repeated, out of order, stall, asked help, first-word grace, line completion, confidence |
| Timing | word boundaries, lookup, lead offset, line lookup, bad data, coarse `currentTime` (250 ms) sampling, pause/reset, WebVTT (incl. Devanagari) |
| Story package | Devanagari byte offsets, punctuation/dash tokens, NDJSON marks, turn selection rules, validator |
| Reading pipeline / TV | Transcribe adapter (stream, partial/stable mapping, timing, retry without stabilisation, close) · reading driver (in-order lighting, misread not lit, stall help, TV help, speech error ends the turn, traces without transcript text) · template summary from real counts · TV Your Turn state machine (all transitions, impossible ones rejected, never backwards) · playback plan (stop/resume/help span/totals) |
| S3 audio | frame tag round-trip; seq missing/duplicate/out-of-order; latency needs a clock estimate (never raw client time); capture-gap detection; 1 kHz click detector; stale-tag frames dropped; test turns need consent; turn cap; mic-live-outside-turn audit with grace; reconnect during a turn ends it; resampler 48k/44.1k/16k passband + anti-alias; worklet chunk size |
| Protocol / server | join, wrong session, missing hello, roles, reader ownership, duplicate turn.start, stale help, cancel, phone lost mid-turn, reconnect, audio only from the active phone, heartbeat timeout, HTTP routes, TS served to browsers |
| Scripted speech (SIMULATED) | starts only on the first audio chunk; partials before stable words; the real engine still rejects misreads (one and two), accepts corrections and ASR spelling slips, helps on a stall, helps every word on silence; Hindi vowel-change misread rejected; deterministic scripts; refused in production |
| S2 harness | labels derived from cases (never results); cases.json = generator output; metrics (recall ≤ 1 s, false accepts, verdict per language); observed-sheet scoring; end-to-end latency join |
| S4 analysis | fixture data with known reference errors reproduced exactly; acoustic onsets within 10 ms; SIMULATED label |
| Content | fixture marks decode to their words (Hindi/English); build-story end to end against a fake Polly client; validator: overlaps, credits, language, turn word counts, schema, Hindi text (combining marks, zero-width, NFC); missing assets and id mismatch on disk |
| Summary | template from counts; Bedrock text only if it keeps exactly the given numbers, names the child and makes no claims; timeout, error and budget fall back |
| Privacy invariants | mic OFF on home, shelf, narration, waiting, turn end, cancel, disconnect, reconnect, hidden, visible again, unload, session end, reload, no consent, offline; ON only at turn start; TV phases |
| Local demo loop (SIMULATED) | story → 2 turns → words lit, one help per turn, mic closed after every turn, summary with real counts, labelled simulated |

## Real-service tests (2026-10-08/09) — MEASURED, see docs/submission/MEASURED_RESULTS.md
S2 (169 lines through Transcribe) · S4 (Polly timing) · align-check (generative narration) · help recovery (before/after,
40 runs) · three real loops on AWS with an adult tester (end-to-end latency n = 38, privacy audit 561 reports) ·
certificate reuse on redeploy · English and Hindi stories end to end.

## Not tested
Children (needs written guardian permission) · physical Fire TV · Bedrock (account blocked).

## Earlier: Vega Virtual Device run of the latest build (2026-10-08, local demo mode, SIMULATED speech): MEASURED from logs.**
- The app launched and found the server at `10.0.2.2:8787`. The VVD's host alias works; the baked LAN IP had gone stale.
- Mina's Red Kite played; narration stopped at both Your Turn lines (free mode).
- The scripted reader's microphone opened for each turn and closed on `line.done` (“Her kite goes up and up.”, then “Look at the bird!”).
- The server produced the summary: “Riya read 8 words independently and needed help with 2 words, and finished “Mina's Red Kite” (2 reading turns, 1 minute).”

Not visually verified by us yet: the turn panel's green/amber rendering, the SIMULATED badge, the diagnostics panel and the end card layout. Those need a screenshot or a screen recording. The first attempt found and fixed two demo bugs: the scripted reader stayed on a stale session, and a stale S1 run file auto-started the timing test.

## S3 — real-phone tests (to run: `npm run s3 -- --label <device>`)

| # | Test | iPhone Safari | Android Chrome |
|---|---|---|---|
| 1 | page load over HTTPS (tunnel), pairing via QR | PASS (run 1) | PASS (run 1) |
| 2 | consent screen shown before any mic request; no `getUserMedia` before a turn | PASS: 0 live tracks while idle (browser API) | PASS: same |
| 3 | mic permission prompt on the first turn; mic opens without a tap once "Get ready" was tapped | PASS: prompt on turn 1 (first chunk 2.8 s); later turns 0.4–0.7 s, no tap | PASS: 0.3–0.8 s, no tap |
| 4 | chunks arrive; level meter moves | PASS (chunks); meter not reported | PASS (chunks); meter not reported |
| 5 | chunk sweep 20/40/60/100 ms × 60 s: latency, loss, capture gaps | PASS: 0 loss; 40 ms median 49.5 ms | PASS: 0 loss; 40 ms median 52.1 ms |
| 6 | acoustic upper bound (afplay tone → server) | 306 ms median (includes afplay/Mac output: Mac part not yet measured) | 340 ms (same caveat) |
| 7 | mic OFF after turn end / skip (browser API), time to off | PASS ≤ 1 s (1-s resolution) | PASS ≤ 1 s |
| 8 | 10-minute turn: loss, duplicates, reordering, reconnects | PASS: 600 s, 14 990 chunks, 0 loss, 0 reconnects | 0 loss in 598 s, but **1 reconnect at 244 s, cause UNKNOWN** |
| 9 | Wi-Fi off ~10 s mid-turn (`--plan network`): mic stops, turn ends, reconnect time | PASS: mic off at socket close; turn ended (5 s heartbeat); reconnect when Wi-Fi back; new turn needed | PASS: mic off at once; fell back to mobile data, reconnect 3.6 s; old turn ended on rejoin |
| 10 | background / lock screen mid-turn: mic stops; return: no restart without a new turn | PASS (lock + app switch: audio `interrupted` → stop; turn ended at once) | PASS (page hidden → stop; turn ended at once) |
| 11 | reload mid-turn: turn ends; mic stays off until a new turn + tap | **not run** | PASS (pagehide → stop; `needs-tap` after reload) |
| 12 | privacy audit: 0 violations over the whole run | PASS (897 + 254 reports) | PASS (880 + 274 reports) |
| 13 | screen wake lock: acquired on Get ready, released when hidden, re-acquired when visible | PASS (API events) — keeps screen on untouched: UNKNOWN | PASS (API events) — keeps screen on untouched: UNKNOWN |

