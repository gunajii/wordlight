# Privacy (for judges)

WordLight is for children, so privacy is part of the design. Full record: [docs/PRIVACY.md](../PRIVACY.md).

- **The microphone is on only during a reading turn.** The phone opens it when the TV starts a turn, and only if a
  parent agreed, the page is visible and connected, and audio was unlocked by a tap. Turn end, cancel, disconnect,
  reload, page hidden, lock and session end all close it; a turn never resumes by itself.
- **Visible state:** the phone always shows “● Listening…” or “Microphone off”; the TV shows it during a turn.
- **Tested and measured:** a privacy-invariant test table covers every phone state
  (`web/phone/test/privacy-invariants.test.js`). On the deployed AWS path the server's microphone audit counted
  **0 violations in 561 status reports** over three sessions, and the mic was off 11–107 ms after every turn end
  (earlier phone tests: 0 in > 2 300).
- **No audio, no transcripts stored.** Audio frames go to Amazon Transcribe during a turn and are discarded by
  WordLight. Voice activity is computed as loudness numbers and kept only as counts. Production traces hold timings
  and counts, never what the child said.
- **Only our AWS endpoint.** Child audio only goes over HTTPS/WSS to the WordLight server on AWS — never through a
  development tunnel; a health check confirms it before a session.
- **AI services opt-out** policy attached to the AWS account (content not used for service improvement).
- **Minimal data:** in memory per session — first name, age, language, counts. In DynamoDB (30-day TTL) — a random
  reader id, age, language, story ids, counts, and the book words the TV helped with. No accounts, no names, no audio.
- **The summary makes no claims:** counts are deterministic; AI wording (when enabled) is rejected if it changes a
  number or claims anything about ability or progress.
- **Children:** only with written parent/guardian permission (docs/CHILD_TESTING.md). No child has used WordLight.
- No legal compliance claim (COPPA, DPDP): this is a hackathon prototype.
