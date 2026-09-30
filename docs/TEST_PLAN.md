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

`npm test` — 70 tests pass (2026-09-30): protocol 4, reading engine 19, karaoke core 7, story package 5, session client 7 (reused), server 24 (incl. S3 stats/sink/hub 13), phone audio worklet 4. `npm run typecheck` clean.

| Area | Covered |
|---|---|
| Reading engine | exact, punctuation, Hindi normalisation, NFC/NFD, partial transcripts, fuzzy (ASR noise), misreads (cat/hat, big/bag, lived/loved, कल/काल, बिल्ली/बल्ली, किताबें/किताबों), skipped, repeated, out of order, stall, asked help, first-word grace, line completion, confidence |
| Timing | word boundaries, lookup, lead offset, line lookup, bad data, coarse `currentTime` (250 ms) sampling, pause/reset, WebVTT (incl. Devanagari) |
| Story package | Devanagari byte offsets, punctuation/dash tokens, NDJSON marks, turn selection rules, validator |
| S3 audio | frame tag round-trip; seq missing/duplicate/out-of-order; latency needs a clock estimate (never raw client time); capture-gap detection; 1 kHz click detector; stale-tag frames dropped; test turns need consent; turn cap; mic-live-outside-turn audit with grace; reconnect during a turn ends it; resampler 48k/44.1k/16k passband + anti-alias; worklet chunk size |
| Protocol / server | join, wrong session, missing hello, roles, reader ownership, duplicate turn.start, stale help, cancel, phone lost mid-turn, reconnect, audio only from the active phone, heartbeat timeout, HTTP routes, TS served to browsers |

## Not yet tested

Real speech (S2), Polly (S4), AWS, end-to-end latency, physical Fire TV.

## S3 — real-phone tests (to run: `npm run s3 -- --label <device>`)

| # | Test | iPhone Safari | Android Chrome |
|---|---|---|---|
| 1 | page load over HTTPS (tunnel), pairing via QR | UNKNOWN | UNKNOWN |
| 2 | consent screen shown before any mic request; no `getUserMedia` before a turn | UNKNOWN | UNKNOWN |
| 3 | mic permission prompt on the first turn; mic opens without a tap once "Get ready" was tapped | UNKNOWN | UNKNOWN |
| 4 | chunks arrive; level meter moves | UNKNOWN | UNKNOWN |
| 5 | chunk sweep 20/40/60/100 ms × 60 s: latency, loss, capture gaps | UNKNOWN | UNKNOWN |
| 6 | acoustic upper bound (afplay tone → server) | UNKNOWN | UNKNOWN |
| 7 | mic OFF after turn end / skip (browser API), time to off | UNKNOWN | UNKNOWN |
| 8 | 10-minute turn: loss, duplicates, reordering, reconnects | UNKNOWN | UNKNOWN |
| 9 | Wi-Fi off ~10 s mid-turn (`--plan network`): mic stops, turn ends, reconnect time | UNKNOWN | UNKNOWN |
| 10 | background / lock screen mid-turn: mic stops; return: no restart without a new turn | UNKNOWN | UNKNOWN |
| 11 | reload mid-turn: turn ends; mic stays off until a new turn + tap | UNKNOWN | UNKNOWN |
| 12 | privacy audit: 0 violations over the whole run | UNKNOWN | UNKNOWN |

