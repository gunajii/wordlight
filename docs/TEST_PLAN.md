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

`npm test` — 53 tests pass (2026-09-29): protocol 4, reading engine 19, karaoke core 7, story package 5, session client 7 (reused), server 11. `npm run typecheck` clean.

| Area | Covered |
|---|---|
| Reading engine | exact, punctuation, Hindi normalisation, NFC/NFD, partial transcripts, fuzzy (ASR noise), misreads (cat/hat, big/bag, lived/loved, कल/काल, बिल्ली/बल्ली, किताबें/किताबों), skipped, repeated, out of order, stall, asked help, first-word grace, line completion, confidence |
| Timing | word boundaries, lookup, lead offset, line lookup, bad data, coarse `currentTime` (250 ms) sampling, pause/reset, WebVTT (incl. Devanagari) |
| Story package | Devanagari byte offsets, punctuation/dash tokens, NDJSON marks, turn selection rules, validator |
| Protocol / server | join, wrong session, missing hello, roles, reader ownership, duplicate turn.start, stale help, cancel, phone lost mid-turn, reconnect, audio only from the active phone, heartbeat timeout, HTTP routes, TS served to browsers |

## Not yet tested

Everything on Vega (S1), real speech (S2), phone microphones (S3), Polly (S4), AWS, end-to-end latency.
