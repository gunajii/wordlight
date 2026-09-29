# Architecture

## Components

```
                         build time                                   live
 StoryWeaver story ─► content pipeline ─► story package ─► S3/CloudFront ─► Fire TV app (Vega)
                      (Polly Kajal: audio +                               │  words light from
                       word speech marks)                                 │  audio position
                                                                          │
 Phone web page ─── audio frames (16 kHz PCM, only in a turn) ─► session server ◄─ turn.start/help/cancel
   consent, reader,                                               │ reading engine ◄─ Transcribe streaming
   listening, summary ◄── line.done / session.summary ─────────── │ word.read/helped/skipped ─► TV
                                                                  └─► DynamoDB (counts only)
```

| Part | Where | Pure / platform | Tests |
|---|---|---|---|
| Reading engine | `packages/reading-engine` | pure TS, clock injected | 19 |
| Timing core | `packages/karaoke-core` | pure TS | 7 |
| Story package | `packages/story-package` | pure TS | 5 |
| Protocol | `packages/shared-protocol` | pure TS | 4 |
| Session client | `packages/session-client` | JS (from Earshot) | 7 |
| Server | `server/` | Node | 11 |
| TV app | `apps/vega-tv` | React Native for Vega | on-device only |
| Phone page | `web/phone` | browser | not started |

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
- The reading engine is a deterministic state machine (cursor, last progress, 3 s stall). Bedrock (Should tier) only chooses turn lines and phrases the parent summary from counts, with a template fallback.

**Matching is deliberately strict.**
- Exact match up to 4 code points; longer words may differ by 1 edit (2 from 8 code points) only if they sound alike AND the edit is not a vowel change. The price: ASR spelling variants like colour/color are rejected. Revisited with S2 data.

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
