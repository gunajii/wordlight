# Architecture

## Components

```
 build time:  StoryWeaver ePub ─► import ─► NarrationService (Amazon Polly | fixture) ─► story package (validated)
                                             audio + word speech marks (UTF-8 bytes)      served by the WordLight server

 live:        Fire TV app (Vega) ── turn.start / help / cancel ──►  WordLight server (EC2, HTTPS/WSS) ──► Amazon Transcribe
                 ▲  narration + <KaraokeLine>                         │ SpeechSource → ReadingDriver →     Streaming
                 └── word.read / helped / skipped / line.done ◄──────┤   ReadingTurn (strict, deterministic)
              Phone web page ── 16 kHz PCM, 40 ms, ONLY during a turn ┘ SummaryService (template | Bedrock, optional)
                 consent · reader · mic ON/OFF · summary ◄── session.summary
```

| Part | Where | Notes |
|---|---|---|
| Reading engine | `packages/reading-engine` | pure TS, clock injected, 25 tests |
| Speech service | `server/src/reading/speech.ts`, `scripted.ts` | Transcribe (production) or scripted LOCAL SIMULATION, behind one interface |
| Reading driver | `server/src/reading/driver.ts` | engine clock starts at the first audio chunk; traces numbers only |
| Turn plan + state machine | `packages/tv-core` | free mode stops before the line; echo mode stops after it |
| Timing / subtitles | `oss/karaoke-vega` | open-source package; the TV's subtitle is `<KaraokeLine>` |
| Story package | `packages/story-package`, `server/src/content.ts` | validated on build and again before the shelf lists it |
| Summary | `server/src/summary.ts` | counts always deterministic; wording by template or guarded Bedrock |
| TV app | `apps/vega-tv` | React Native for Vega |
| Phone page | `web/phone` | browser, no install |
| Infra | `infra/aws` | one EC2 instance, Caddy TLS, instance role; no database (counts are per session, in memory) |

## Decisions

**TypeScript without a build step.**
- Recommended: TypeScript with erasable syntax only; Node runs it directly (type stripping), `tsc` only type-checks; the server strips types when serving packages to the browser; `setup.sh` vendors them into the Vega app.
- Why: one language, pure modules testable with `node --test`, no bundler to debug.
- Main risk: needs Node ≥ 22.18 (the Mac has 25.8.1); no enums or parameter properties.
- Alternative: JS + JSDoc (as in Earshot).

**Page audio covers every line, including turn lines.**
- Recommended: one narration file per page; during a turn the TV pauses before the line and resumes after it. Help replays the word's span.
- Why: the story still works without a phone; no extra audio per word; one timing source.
- Main risk: help depends on accurate seeking on Vega (measured in S1 via line jumps).
- Alternative: separate Polly clips per turn line / help word (schema already allows `clip`).

**The model never judges the child.**
- The reading engine is a deterministic state machine (cursor, last progress, 3 s stall). Bedrock is optional and
  only rewords the parent summary. Its text must contain exactly the given numbers and make no claims, or the
  template is used. Turn lines are chosen deterministically.

**Free reading vs Echo Mode is configuration, not code** (`READING_MODE`). Echo Mode is the S2 fallback and is
weaker: the child repeats a line they just heard, which is not the same as reading it.

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
| `word.read` / `word.helped` / `word.skipped` / `line.done` | server → TV (+ phone) | clients may never send these |
| `turn.help` | TV → server | must match the active turn |
| `turn.cancel` | TV → server → phone, or server → both | phone lost mid-turn cancels automatically |
| `reader.status` | server → TV | on phone join/leave |
