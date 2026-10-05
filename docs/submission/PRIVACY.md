# Privacy (for judges)

WordLight is for children, so privacy is part of the design. This page summarises it. The full record is in
[docs/PRIVACY.md](../PRIVACY.md).

- **The microphone is on only during a reading turn.** The phone page opens it when the TV starts a turn, and only if:
  - a parent agreed on the phone;
  - the page is visible and connected;
  - the audio was unlocked by a tap.

  Anything else closes it: turn end, cancel, disconnect, reload, page hidden, lock, session end. A turn never resumes
  by itself.
- **Visible state.** The phone always shows MIC ON or MIC OFF. The TV shows it during a turn.
- **Tested.** A privacy-invariant test table covers every product state (`web/phone/test/privacy-invariants.test.js`).
  In real-phone tests (S3) the server's microphone audit counted **0 violations** across more than 2,300 status
  reports.
- **No raw audio is stored.** Audio frames go to Amazon Transcribe during a turn and are discarded by WordLight.
  The server keeps counts and timings only. Transcript text is never stored or logged in production.
- **Only our AWS endpoint.** Child audio only ever goes over HTTPS/WSS to the WordLight server on AWS. The development
  tunnel is used only for test tones and adult test speech. A health check confirms the endpoint (TLS, real speech,
  no tunnel) before any child session.
- **The AI services opt-out** policy is attached to the account, so Transcribe/Polly content is not used for service
  improvement. The effective policy is still to be confirmed.
- **Minimal data.** First name, age, language, and reading counts for the summary, held per session in memory. No
  accounts, no database.
- **The summary makes no claims.** Counts are computed deterministically. Optional AI wording is rejected if it
  changes a number or claims anything about ability or progress.
- **Testing with children:** only with written parent/guardian permission (docs/CHILD_TESTING.md). No child has
  used WordLight yet.
- We make **no legal compliance claim** (e.g. COPPA, DPDP). This is a hackathon prototype.
