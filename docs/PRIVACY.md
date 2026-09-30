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
- Child audio never goes through the Cloudflare dev tunnel; only through the AWS-hosted HTTPS endpoint (not built yet).
