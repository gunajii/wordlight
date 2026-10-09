# WordLight — Devpost text

Every number below is in docs/submission/MEASURED_RESULTS.md with its device, sample and method.

## Tagline
The TV already has the words. WordLight teaches your child to read them.

## Inspiration
Children already see words on the TV — titles, subtitles, songs — but watching is passive. Same-language subtitling
(lighting words as they are spoken) has been used in Indian literacy programmes. We wanted the next step: the TV
stops, and the child reads.

## What it does
WordLight turns a family Fire TV into an interactive reading stage: the TV narrates and shows the words, while a phone
lets the child read back and get immediate, encouraging feedback.
- **Listen:** an illustrated story plays; each word lights up as the narrator says it.
- **Your turn:** at a marked line the TV says **“Riya, now you say it.”** Riya repeats the line into a phone paired by
  QR code (a web page, no app). Each word turns green on the TV as she says it.
- **Help, never “wrong”:** if she is stuck, the TV waits while she is still trying (a stutter counts as trying), then
  says the word slowly from its own clip and marks it amber — and gives her the chance to say it herself (✓).
- **Well read!** The TV and the parent's phone show what happened: words read on her own, words that needed help.
- **Two languages:** *Busy Ants* (Pratham Books, StoryWeaver, CC BY 4.0) in English, and our own Hindi translation.

## How we built it
- **Fire TV / Vega OS:** React Native for Vega, the W3C `AudioPlayer`, remote-only navigation, a diagnostics overlay.
  Word timing uses our open-source `@wordlight/karaoke-vega`, which turns a coarse `currentTime` into an accurate
  playhead and cancels the measured audio latency.
- **AI that responds to the child (not a chatbot):**
  - **Amazon Transcribe Streaming** hears the child (en-IN, hi-IN) through our AWS server.
  - A **strict, deterministic reading engine** decides what lights: a misread does not light; spelling noise on long
    words is tolerated, vowel changes (big/bag, कल/काल) are not; the cursor never goes backwards.
  - A **voice-activity detector** on the phone audio tells “still trying” from silence, so help never interrupts.
- **Narration with Amazon Polly:** the expressive generative Kajal voice for English and neural Kajal for Hindi (SSML
  pace, volume, pauses), plus a slow single-word clip for every word in a reading line. Polly's generative voice has
  no word timings, so Amazon Transcribe listens to the narration and our aligner maps its words onto the known text.
- **AWS:** one Graviton EC2 instance behind Caddy TLS (CloudFormation, SSM, instance role, private S3), DynamoDB for
  per-session counts, AWS Budgets with a USD 100 ceiling, and the AWS AI-services opt-out for a children's app.
- **Privacy by design:** the microphone is on only during a reading turn and the phone always shows it; no audio or
  transcript text is stored; audio goes only to our AWS endpoint.

## What we measured (and what we decided because of it)
- **Highlight sync on the Vega Virtual Device:** median −1.0 ms, SD 11 ms over 242 words after a one-time latency
  calibration. Physical Fire TV: not tested.
- **Phone microphone:** ≈ 52 000 audio chunks, 0 lost; capture → server 50–90 ms (iPhone Safari, Android Chrome).
- **Speech recognition (169 test lines, synthetic adult voice):** ≈ 95 % of words recognised, but only 51 % within
  1 s. So we chose **Echo Mode** — hear the line, then say it — instead of asking the child to read first.
- **Real loop (phone → AWS → Transcribe → TV, adult tester):** a word lights a median 1.08 s after it is spoken
  (38 words); the network and TV add ≈ 60 ms.
- **Narration timing:** Polly's speech marks were within 50 ms for 53 % of words; our generative-voice alignment
  measured a 40 ms median error vs 52 ms on the same pages.
- **Help timing:** the next word was helped too early in 1 of 20 synthetic runs before our fix, 0 of 20 after.
- **Privacy on AWS:** 790 microphone status reports from the phone, 0 violations.
- We have **not** tested with children and do **not** claim any effect on reading.

## Challenges
- Recognition latency (~1 s) made “read first” feel late: measured, then redesigned around Echo Mode.
- Polly speech marks are UTF-8 byte offsets (3 bytes per Devanagari character); SSML shifts them again.
- The Vega media player silently refuses `http://` media; the virtual device's drifting clock broke HTTPS.
- A new AWS account: staggered service activation, Bedrock blocked at account level, EC2 capacity on restart — all in
  our friction log.

## What's next
Testing with children (only with written guardian permission, protocol ready), a physical Fire TV, more StoryWeaver
stories, and Amazon Bedrock for the parent summary once our account is authorised (built, guarded, falling back to a
template today).

## Built with
Vega OS (React Native for Vega), Amazon Transcribe Streaming, Amazon Polly (neural + generative), Amazon EC2, AWS
CloudFormation, AWS IAM, AWS Systems Manager, Amazon S3, Amazon DynamoDB, AWS Organizations (AI services opt-out), AWS
Budgets, Node.js, TypeScript, WebSockets, Caddy, StoryWeaver (CC BY 4.0).
