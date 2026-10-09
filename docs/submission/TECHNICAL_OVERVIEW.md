# Technical overview

## The loop (Echo Mode, the product's interaction)
1. **TV (Vega)** plays the page narration. Every 20 ms `PlayheadSampler` turns `currentTime` into an accurate
   position and `<KaraokeLine>` lights the current word (per-device lead: −392 ms on the Virtual Device, measured).
2. At a turn line the `tv-core` plan stops narration once the line has been **heard** to its end
   (`echoStopAt`: line end + 150 ms + output latency, never past the next line's start). The TV sends `turn.start`.
3. The **server** forwards the turn to the reader's phone with an audio tag. The **phone** (consented, connected,
   visible, unlocked) opens the mic and streams 16 kHz PCM16 in 40 ms binary frames over WSS to the AWS server.
4. The server runs each frame through a **voice-activity detector** (RMS against an adaptive room floor) and into
   **Amazon Transcribe Streaming** (stability high). The **ReadingDriver** feeds every transcript update to the
   **ReadingTurn** engine → `word.read` / `word.skipped` / `word.helped` / `word.repeated` / `line.done`.
5. The TV lights words green. On `word.helped` it plays that word's **help clip** (Polly, alone, 80 % rate) in a
   separate player — the page narration is never moved during a turn — marks it amber, and reports
   `turn.help.done` when the clip ends. The child may then say the word back (✓). On `line.done`: “Well read!”,
   the mic closes, narration resumes.
6. At the end: `session.end` → deterministic counts → summary (template; Bedrock when authorised) → TV and phone;
   counts only to DynamoDB.

## Reading engine (`packages/reading-engine`, deterministic, strict)
- Normalisation: NFC, punctuation, case; Hindi nukta, chandrabindu/anusvara, nasal virama, ये/ए, digits/number words.
- Match: exact up to 4 code points; longer words may differ by 1 edit (2 from 8), only if they sound alike and the
  edit is not a vowel. Cursor never goes backwards; one omission per line; substitutions resync (≤ 2 ahead);
  hyphenated words only on an exact join.
- **Help rule:** no progress AND no speech activity for 3 s (5 s before the first word); help anyway after 6 s of
  continuous sound without progress. After a help the clock waits for the TV's `turn.help.done` (fallback 4 s),
  then the child gets a full 3 s; **say it back:** hearing the helped word → ✓; going on or quiet → move on, no
  second help. Counts stay honest: a helped word is “with help” either way.

## Narration and timing (`tools/content`, `packages/story-package`)
- Story text → display lines → SSML (rate, volume, pauses) → Polly. Speech-mark byte offsets point into the SSML; we
  map them back to the text bytes and validate every mark (`markByteMismatches`); Polly's marks for SSML tags (seen in
  hi-IN) are dropped.
- English uses Polly **generative** Kajal (no speech marks): Amazon Transcribe listens to the narration, an
  edit-distance alignment maps recognised words onto the known text, unmatched words are interpolated, and a
  calibrated offset is applied (`tools/s4/align-check.ts` measured it against acoustic onsets before adoption).
- Line ends come from the first real pause in the audio after the last word (`pauseStartMs`), so echo stops land in
  the silence between lines. Polly audio and Transcribe results are cached: the audio that was measured is shipped.

## Service boundaries (real ↔ local, local is always labelled)
| Boundary | Production | Local |
|---|---|---|
| SpeechSource | `TranscribeSource` | `ScriptedSource` — SIMULATED, refused when `NODE_ENV=production` |
| NarrationService | `PollyNarration`, `GenerativeNarration` | `FixtureNarration` — tones, test content only |
| SummaryService | `BedrockSummaryService` (guarded) | `LocalSummaryService` — template (current default) |
| ProgressStore | `DynamoProgressStore` | `MemoryProgressStore` |

## Deployment
- CloudFormation stack: one Graviton EC2 instance (t4g.micro; moved to t4g.small on 2026-10-09 when the micro had no
  capacity), Elastic IP, Caddy TLS (RSA, Let's Encrypt) on `<ip>.sslip.io`, instance role, DynamoDB table, idle
  auto-stop after 90 min, journald capped. No SSH: updates through SSM (`deploy.sh` → `wordlight-update` →
  `on-update.sh`), which keeps the certificate (verified).
- `tools/ops/healthcheck.ts`: TLS + certificate, speech is real (not simulated), media/join links on this host (no
  tunnel), WSS round trip.
- Cost guard: AWS Budgets USD 100 ceiling with alerts at 60/80/90/95, daily caps in the server's usage meter
  (Transcribe 60 min, Polly 150k characters, Bedrock 300 calls).

## Testing
- 197 automated tests (`npm test`): engine rules incl. help/say-it-back timing, voice activity, driver end to end,
  protocol validation, privacy invariants for every phone state, story validation, SSML mapping, alignment, TV state
  machine and plan, overlay syntax.
- Harnesses on real services: S2 (169 lines through Transcribe), S4 (Polly timing), align-check, help recovery,
  end-to-end latency join, phone streaming (S3), A/V sync on the Virtual Device (S1).
