# Architecture

## Components

```
 build time:  StoryWeaver PDF ─► import ─► NarrationService ─► story package (validated) ─► S3 ─► WordLight server
                                Polly neural (Hindi): audio + speech marks (UTF-8 bytes, mapped back from SSML)
                                Polly generative (English): audio; word times from Amazon Transcribe aligned to the text
                                Polly neural: one slow help clip per turn-line word

 live:        Fire TV app (Vega) ── turn.start / help / cancel ──►  WordLight server (EC2, HTTPS/WSS) ──► Amazon Transcribe
                 ▲  narration + <KaraokeLine>                         │ VoiceActivity + SpeechSource →     Streaming
                 │  help clip player ── turn.help.done ──────────────►│ ReadingDriver → ReadingTurn (strict)
                 └── word.read / helped / repeated / skipped / line.done ◄┤ DynamoDB: counts per session
              Phone web page ── 16 kHz PCM, 40 ms, ONLY during a turn ┘ SummaryService (template | Bedrock, optional)
                 consent · reader · mic ON/OFF · summary ◄── session.summary
```

| Part | Where | Notes |
|---|---|---|
| Reading engine | `packages/reading-engine` | pure TS, clock injected, 25 tests |
| Speech service | `server/src/reading/speech.ts`, `scripted.ts` | Transcribe (production) or scripted LOCAL SIMULATION, behind one interface |
| Reading driver | `server/src/reading/driver.ts` | engine clock starts at the first audio chunk; traces numbers only |
| Turn plan + state machine | `packages/tv-core` | echo mode (the product) stops once the line is heard, never past the next line; free mode stops before it; child-facing text in English/Hindi |
| Timing / subtitles | `oss/karaoke-vega` | open-source package; the TV's subtitle is `<KaraokeLine>` |
| Story package | `packages/story-package`, `server/src/content.ts` | validated on build and again before the shelf lists it |
| Summary | `server/src/summary.ts` | counts always deterministic; wording by template or guarded Bedrock |
| TV app | `apps/vega-tv` | React Native for Vega |
| Phone page | `web/phone` | browser, no install |
| Voice activity | `server/src/reading/vad.ts` | loudness vs an adaptive room floor, per 40 ms chunk; keeps the help clock waiting while the child makes sound; numbers only |
| Progress | `server/src/progress.ts` | DynamoDB (on-demand, 30-day TTL): random reader id, age, language, story ids, counts — no names, audio or speech text |
| Infra | `infra/aws` | CloudFormation: one Graviton EC2 instance, Elastic IP, Caddy TLS, instance role, DynamoDB table; SSM updates; start script with capacity fallback |

## Decisions

**TypeScript without a build step.**
- Recommended: TypeScript with erasable syntax only; Node runs it directly (type stripping), `tsc` only type-checks; the server strips types when serving packages to the browser; `setup.sh` vendors them into the Vega app.
- Why: one language, pure modules testable with `node --test`, no bundler to debug.
- Main risk: needs Node ≥ 22.18 (the Mac has 25.8.1); no enums or parameter properties.
- Alternative: JS + JSDoc (as in Earshot).

**Page audio covers every line; help words have their own clips.**
- One narration file per page; during a turn the page audio stays paused. Help plays a separate clip of the word
  (Polly, alone, 80 % rate) in a second player.
- Why (changed 2026-10-08 after a real test): seeking + playing one word inside the page audio on the Virtual Device
  could outlast the word, and the rest of the line played. Clips also say the word more clearly.

**The model never judges the child.**
- The reading engine is a deterministic state machine (cursor, last progress, 3 s stall). Bedrock is optional and
  only rewords the parent summary. Its text must contain exactly the given numbers and make no claims, or the
  template is used. Turn lines are chosen deterministically.

**Echo Mode is the product's interaction** (`READING_MODE=echo`; free reading stays in the code). Decided from S2:
Transcribe recognised ≈ 95 % of words but only ≈ 51 % within 1 s, so "child reads first" would light words late.
Honest limit: repeating a line just heard is guided practice, not independent reading; the TV still shows every word,
the child still has to say each one, and help still applies.

**Help is timed around the child, not the clock** (2026-10-09, after real tests): no help while the child is making
sound (up to 6 s); after a help the clock starts only when the help word has finished playing; the child can then
say the word back before the line moves on.

**Mockable service boundaries.** Speech recognition (`SpeechSource`), narration (`NarrationService`) and summary
(`SummaryService`) each have an AWS implementation and a deterministic local one. Local ones are labelled
simulated wherever their output appears, and the scripted speech source refuses to run in production.

**Matching is deliberately strict.**
- Exact match up to 4 code points; longer words may differ by 1 edit (2 from 8 code points) only if they sound alike AND the edit is not a vowel change. The price: ASR spelling variants like colour/color are rejected. The scripted S2 run found two resync gaps (two misreads in a line; hyphenated words), now fixed without loosening matching (docs/SPIKES.md, S2).

## Protocol

JSON events over the session WebSocket (`packages/shared-protocol/src/events.ts`); binary frames for audio (`audio.ts`). The server stamps `serverMs` on everything it relays; clients stamp `sentAtMs` and run clock sync (from Earshot) so every hop of "child says a word → word lights" can be timed.

| Event | From → to | Server checks |
|---|---|---|
| `reader.save` | phone → server → TV | explicit mic consent present |
| `turn.start` | TV → server → reader's phone | known reader, phone online, idempotent per `turnId` |
| audio frame | phone → server | only the active turn's phone |
| `word.read` / `word.helped` / `word.skipped` / `word.repeated` / `line.done` | server → TV (+ phone) | clients may never send these |
| `turn.help` | TV → server | must match the active turn |
| `turn.help.done` | TV → server | the help word finished playing (restarts the child's time) |
| `turn.cancel` | TV → server → phone, or server → both | phone lost mid-turn cancels automatically |
| `reader.status` | server → TV | on phone join/leave |
