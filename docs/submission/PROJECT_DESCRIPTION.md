# WordLight — Devpost draft

> Fill the bracketed [MEASURE] slots only from docs/submission/MEASURED_RESULTS.md. If a number isn't measured, remove
> the sentence; don't round up.

## Inspiration
Children already see words on the TV: titles, subtitles, songs. But watching is passive. Same-language subtitling
(highlighting words as they are spoken) has been used in Indian literacy programmes. We wanted to take that idea one
step further: the TV stops, and the child reads.

## What it does
**WordLight turns a narrated picture-book story on Fire TV into reading practice.**
- Each word lights up as the narrator says it.
- At a marked line, the TV says **"Riya, your turn."** Riya reads the line aloud into a phone paired by QR code. As
  she says each word, it lights up on the TV.
- If she stalls for about 3 seconds, the TV says the next word and marks it amber, then the story carries on.
  Nothing is ever marked "wrong".
- At the end, the parent's phone shows a plain summary: words read independently, and words that needed help.
- Stories come from Pratham Books' StoryWeaver (CC BY 4.0) in English and Hindi.

## How we built it
- **Fire TV / Vega OS.** The app is built with React Native for Vega and plays narration through the W3C
  `AudioPlayer`. Word timing uses our open-source `@wordlight/karaoke-vega`, which turns a coarse `currentTime` into
  an accurate playhead and corrects for measured audio latency. It is fully usable with the remote.
- **AI.**
  - Amazon Transcribe Streaming recognises what the child reads, with partial results streamed as the child speaks.
  - A **strict, deterministic reading engine** decides what lights. AI never judges the child. A misread word does
    not light. Spelling noise on long words is tolerated; vowel changes (big/bag, कल/काल) are not.
  - Amazon Polly (neural, Kajal) narrates each story. Its word speech marks, mapped by UTF-8 byte offset so
    Devanagari works, drive the highlight.
- **Multimodal.** TV, remote, phone microphone (no app install, a web page) and cloud speech services.
- **Family.** The parent consents on the phone. The parent summary is computed from real counts. Optionally,
  Bedrock rewords it, but the result is rejected if it changes a number or makes a claim.
- **Privacy by design.**
  - The microphone is on only during a reading turn, and the phone always shows ON/OFF.
  - Automated tests check this in every state.
  - WordLight stores no audio and no transcript text, only counts.
  - Child audio goes only to our AWS HTTPS endpoint.

## Evidence (only what we measured)
- **Narration and highlight in sync on the Vega Virtual Device:** median offset −1.0 ms, SD 11 ms, drift < 1 ms/min,
  over 242 words, after a one-time latency calibration. Physical Fire TV: not yet tested.
- **Phone microphone (iPhone Safari, Android Chrome):** about 52,000 audio chunks with 0 lost; capture → server
  median 50–90 ms. The microphone switched off at every interruption we tested (Wi-Fi loss, lock, app switch, reload).
- **Speech recognition in the loop:** [MEASURE: S2 — % of correctly read words lit within 1 s; % of misreads accepted;
  per language; speaker = adult/synthetic].
- **Polly word timing:** [MEASURE: S4 — % of words within 50 ms].
- **End to end** (word spoken → lit on TV): [MEASURE].
- We have **not** measured any effect on children's reading, and we don't claim one.

## Challenges
- Vega's media player silently refuses `http://` media (MediaError 4). The only clue was in the native log.
- Polly speech marks are byte offsets: Devanagari is 3 bytes per character.
- Phone microphones must stop on lock, app switch and network loss, and must never resume on their own.
- New-account AWS onboarding: our friction log has the details.

## What we learned / What's next
[after measurement]: free reading vs Echo Mode decision; physical Fire TV; a second story/language; consented
child testing following our protocol.

## Built with
Vega OS (React Native for Vega), Amazon Transcribe Streaming, Amazon Polly, Amazon EC2, AWS CloudFormation, AWS IAM,
AWS Systems Manager, Amazon S3, AWS Organizations (AI services opt-out), AWS Budgets, Amazon Bedrock (optional),
Node.js, TypeScript, WebSockets, Caddy, StoryWeaver (CC BY 4.0).
