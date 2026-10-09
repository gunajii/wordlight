# Privacy

Children use WordLight. Privacy is a product requirement, not a feature.

## Rules (design)

- The microphone opens **only during a reading turn**, never while browsing or listening.
- A parent gives **explicit consent** on the phone before the first turn; the server refuses a reader without it (`reader.save` validation).
- Audio is streamed to Amazon Transcribe for recognition and **not stored** by WordLight: no voice archive, nothing written to S3 or logs.
- Stored: reader first name, age, language, and reading outcomes (counts, per-word read/helped/skipped) needed for the parent summary.
- Test recordings of children: only with a parent's permission, kept outside git (`recordings/` is ignored), deleted after the spike.

## To verify before the AWS streaming path is built (UNKNOWN)

- Amazon Transcribe streaming data use and retention, and the AI-services opt-out policy for the account.
- That no server, load-balancer or CloudWatch log captures audio frames or transcripts.
- Whether any regional or child-privacy law applies to the demo deployment. **We make no compliance claim.**

## Development HTTPS tunnel (added 2026-09-30)
`tools/dev-tunnel/dev-tunnel.sh` exposes the local dev server through a Cloudflare quick tunnel, because Vega's media player refuses `http://` media (FRICTION_LOG W5). Traffic through it passes Cloudflare's network, and the URL is public while it runs. Rules:
- Used for synthetic test media (S1 click tracks) and adult test speech only.
- **No child audio goes through it.** Any session with a child uses an HTTPS endpoint we control (AWS), after the logging/retention check in this document.
- Stop the tunnel when not testing (Ctrl-C deletes `.dev/media-url`).

## S3 microphone spike (added 2026-09-30)
- The server's S3 sink measures the stream and discards it: no PCM is stored, logged, forwarded or put in telemetry. It keeps per-turn **numbers** (counts, latencies, capture gaps, test-tone onset times) in memory and in `bench/runs/s3/` (gitignored).
- The optional test-tone detector reads the stream only to find onsets of a synthetic 1 kHz tone; it keeps timestamps, not audio.
- Microphone lifecycle and its browser-API audit: see docs/SPIKES.md, "S3 — privacy mechanisms".
- S3 runs use test tones and adult speech only, through the dev tunnel (Cloudflare). No child's voice.

## AWS processing (added 2026-09-30, before any AWS use)
- Transcribe and Polly may retain content for service improvement unless the account opts out; WordLight requires the AI services opt-out policy (docs/AWS.md) before any child audio is sent. Verify the effective policy; do not assume.
- Speech is streamed to Transcribe during a turn and not stored by WordLight. What Transcribe itself retains after opt-out is governed by AWS's terms; WordLight makes no stronger claim.
- Child audio never goes through the Cloudflare dev tunnel; only through the AWS-hosted HTTPS endpoint (deployed 2026-10-08; the health check confirms TLS, real speech and no tunnel links).
- Voice activity (2026-10-09): the server measures the loudness of each 40 ms chunk to tell "still trying" from silence. It keeps two counts and two loudness numbers per turn; no audio.
- DynamoDB (2026-10-08): per-session counts only — random reader id, age, language, story ids, words read/helped/skipped, duration, the book words the TV helped with; 30-day TTL. No names, audio or speech text.
- Measured on the deployed path (2026-10-08/09): 0 violations in 790 microphone status reports over 4 sessions; mic off 8–107 ms after each turn end.

## S3 run 2 observations (2026-10-05)
- Android switched to mobile data when Wi-Fi was turned off, and a later turn streamed over it (TLS end to end). Whether a family wants that is a product choice; the page can show the connection type (`navigator.connection` is available on Chrome, not Safari).
- In every interruption tested (Wi-Fi loss, lock, app switch, reload), the microphone stopped at the interruption itself; 0 live-mic reports outside turns.

## Built-in safeguards (2026-10-05)
- **Simulation can't pass as recognition.** With the scripted local speech source, `/api/config` says
  `simulated: true`, the TV shows "SIMULATED SPEECH" on every screen, the phone shows a "Local simulation" banner,
  and every trace is marked simulated. The S2 tools refuse simulated traces. The server refuses to run it with
  `NODE_ENV=production`.
- **Privacy invariant tests** (`web/phone/test/privacy-invariants.test.js`) cover each product state: home, shelf,
  narration, waiting, turn start, turn end, cancel, disconnect, reload, page hidden and session end. The microphone
  is ON only at turn start.
- **AWS server logs.** journald only, capped at 50 MB and kept 7 days. No access logs, no CloudWatch. Counts and
  ids are logged, never audio or transcript text. `tools/ops/healthcheck.ts` checks that the deployed path uses
  real speech, TLS and its own host (not a tunnel) before any child session.
- **Parent summary.** The counts are computed by the server. Optional Bedrock wording gets only the first name and
  counts, never audio or transcripts. Its text is rejected if it changes a number or makes a claim about ability
  or progress.
- **Child testing protocol:** `docs/CHILD_TESTING.md`. It requires written permission, uses the AWS path only and
  prefers no recording. If recordings are made, they stay outside Git and are deleted after scoring.
- **Still to verify on the real account:** that the effective AI opt-out policy shows `optOut` (the first check,
  on 2026-10-05, printed `{}`), and what Transcribe retains under that policy. We make no compliance claim.
