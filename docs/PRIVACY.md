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
