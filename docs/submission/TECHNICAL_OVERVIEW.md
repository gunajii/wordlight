# Technical overview

## The loop
1. The **TV** (Vega) plays page narration. Every 20 ms, `PlayheadSampler` turns `currentTime` into an accurate
   position, and `<KaraokeLine>` lights the current word (with the calibrated lead).
2. Narration reaches a turn line. The `tv-core` plan says where to stop: **free mode** stops 120 ms before the line,
   **echo mode** stops just after it. The TV pauses and sends `turn.start`.
3. The **server** forwards the turn to the reader's phone with an audio tag. The **phone** (if consented, connected,
   visible and unlocked) opens the microphone and streams 16 kHz PCM16 in 40 ms binary frames over WSS.
4. The server feeds frames to the **SpeechSource**: Amazon Transcribe Streaming, with partial-result stabilisation.
   The **ReadingDriver** passes each transcript update to the **ReadingTurn** engine, which emits
   `word.read` / `word.skipped` / `word.helped` / `line.done`.
5. The TV lights words green. On `word.helped` (3 s without progress, or OK on the remote) it replays that word's span
   of the narration and marks it amber. On `line.done` it shows "Well read!", closes the turn, and resumes narration.
   The phone receives the same events and closes the microphone.
6. At the end, `session.end` → server: deterministic counts → SummaryService → `session.summary` to the TV and phone.

## Reading engine (deterministic, strict)
- Normalisation: NFC, punctuation, case; Hindi nukta, chandrabindu/anusvara, nasal virama, ये/ए, digits and number
  words.
- Match: exact up to 4 code points. Longer words may differ by 1 edit (2 edits from 8 code points), only if they sound
  alike and the edit is not a vowel.
- The cursor never goes backwards. Omissions use a budget of one skip. Substitutions resync without using it (at most
  two words ahead). Hyphenated words match only on an exact join.
- Help after 3 s with no progress (5 s before the first word). The engine clock starts at the first audio chunk.

## Timing
- The narration's word times come from Polly speech marks (UTF-8 byte offsets → display tokens). We validate the
  mapping (`markByteMismatches`) and the story package before the TV sees it.
- A per-device lead cancels audio output latency (VVD: −339 ms M4A / −392 ms MP3, measured).
- Latency instrumentation, all on one server clock:
  - phone capture time (clock-synced);
  - recogniser word start;
  - server emit time;
  - TV `word-lit` time (clock-synced).

## Service boundaries (real ↔ local)
| Boundary | Production | Local (labelled) |
|---|---|---|
| SpeechSource | `TranscribeSource` | `ScriptedSource`: SIMULATED, refused in production |
| NarrationService | `PollyNarration` | `FixtureNarration`: tones and exact marks, test content only |
| SummaryService | `BedrockSummaryService` (optional, guarded) | `LocalSummaryService`: template (the default) |

## Deployment
- One EC2 t4g.micro with an Elastic IP, Caddy TLS on `<ip>.sslip.io`, and an instance role for Transcribe and Polly.
- No SSH: administration is through SSM.
- The CloudFormation template and `deploy.sh` upload the code to a private S3 bucket and update via SSM.
  `tools/ops/healthcheck.ts` checks TLS, that speech is real, that links don't point at a tunnel, and WSS.
- Logs: journald only, capped. Cost guard: AWS Budgets at USD 5 gross plus a USD 1 alert, and stop/delete commands.

## Testing
- 165 automated tests (`npm test`).
- Harnesses: S1 A/V offset, S3 phone streaming, S2 recognition (169 cases), S4 Polly timing, and an end-to-end
  latency join.
- A headless end-to-end check of the whole loop with the scripted simulation (`npm run demo:check`).
